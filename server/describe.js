import OpenAI from "openai";
import { CATEGORIES } from "../src/utils/categories.js";

// What a photograph is of, said the way a listing says it: which category it
// is in, a name for it and a few lines about it. The phone asks this the moment a photo is taken, so that its form opens
// already filled in; an OpenAI model looks at the picture and answers.
//
// It needs a key — OPENAI_API_KEY in .env. Without one the server says it
// cannot (see `canDescribe`), and the phone leaves the form to be filled in by
// hand. Which model is asked is RAB_DESCRIBE_MODEL's to say.

const MODEL = process.env.RAB_DESCRIBE_MODEL || "gpt-4o-mini";

const LANGUAGES = { en: "English", zh: "Simplified Chinese", ja: "Japanese" };

// What the answer has to be: exactly these three, and nothing else.
const LISTING = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["category", "title", "description"],
  additionalProperties: false,
};

const SYSTEM = `rab is a marketplace where people rent out what they have. Somebody has just photographed something they want to rent out, and you fill in its listing from the photograph.

Every listing has one of these categories: ${CATEGORIES.join(", ")}.

Most are things that are owned and lent — a camera, a car, a tent; some are places — a room, a studio, a parking spot; some are somebody's time and skill. A photograph seldom shows somebody's time, so choose one of those only when the picture is plainly of somebody at work or of an advertisement for a service.

Answer with:
- category: one of the categories exactly as written above; "other" where none fits. Do not stretch a category to cover something it is not: a pen is "other", not "electronics".
- title: what a renter would search for — the thing itself, with its make and model where they can be read off it. A few words, no full stop, nothing about renting.
- description: two or three plain sentences a renter would want: what it is, what can be seen of its condition and what comes with it. Only what the photograph shows — no price, no promises, nothing invented.

Write the title and the description in the language you are asked for.`;

let client = null;

// Whether there is a key to ask with at all.
export function canDescribe() {
  return Boolean(process.env.OPENAI_API_KEY);
}

const MEDIA_TYPES = [
  ["image/jpeg", (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8],
  ["image/png", (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50],
  ["image/webp", (bytes) => bytes.subarray(8, 12).toString("latin1") === "WEBP"],
];

// The listing for a photograph, or null where the model would not give one.
// A category that is not one of rab's becomes "other".
export async function describeImage(buffer, language) {
  const mediaType = MEDIA_TYPES.find(([, matches]) => matches(buffer))?.[0];
  if (!mediaType) return null;
  client ??= new OpenAI();
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_schema", json_schema: { name: "listing", strict: true, schema: LISTING } },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: `Fill in the listing for this photograph. Write in ${LANGUAGES[language] ?? LANGUAGES.en}.` },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${buffer.toString("base64")}` } },
        ],
      },
    ],
  });
  const message = completion.choices[0]?.message;
  if (!message || message.refusal || !message.content) return null;
  let answer;
  try {
    answer = JSON.parse(message.content);
  } catch {
    return null;
  }
  if (!answer || typeof answer !== "object") return null;
  return {
    category: CATEGORIES.includes(answer.category) ? answer.category : "other",
    title: String(answer.title ?? "").trim(),
    description: String(answer.description ?? "").trim(),
  };
}

// Which category a listing is in, from what it already says — its name, its
// few words for what it is, its description — and its main photograph, where
// it has one: the button beside the category on the form. Only the category
// is answered; nothing written is changed.
const CATEGORY = {
  type: "object",
  properties: { category: { type: "string", enum: CATEGORIES } },
  required: ["category"],
  additionalProperties: false,
};

const CLASSIFY = `rab is a marketplace where people rent out what they have: things, places, and somebody's time and skill. A listing is also sometimes a spot — a shop, a venue or a business that collects several listings.

Every listing has one of these categories: ${CATEGORIES.join(", ")}.

You are given what a listing says about itself and, where there is one, its main photograph. Answer with the one category that fits it best, exactly as written above; "other" where none fits. Do not stretch a category to cover something it is not.`;

// The category, or null where the model would not give one. `image` is the
// photograph's bytes, or null.
export async function classifyListing({ title, what, description, image }) {
  const mediaType = image ? MEDIA_TYPES.find(([, matches]) => matches(image))?.[0] : null;
  const said = [title && `Name: ${title}`, what && `What it is: ${what}`, description && `Description: ${description}`].filter(Boolean).join("\n");
  if (!said && !mediaType) return null;
  client ??= new OpenAI();
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_schema", json_schema: { name: "category", strict: true, schema: CATEGORY } },
    messages: [
      { role: "system", content: CLASSIFY },
      {
        role: "user",
        content: [
          { type: "text", text: said || "This listing says nothing about itself yet: go by the photograph." },
          ...(mediaType ? [{ type: "image_url", image_url: { url: `data:${mediaType};base64,${image.toString("base64")}` } }] : []),
        ],
      },
    ],
  });
  const message = completion.choices[0]?.message;
  if (!message || message.refusal || !message.content) return null;
  try {
    const answer = JSON.parse(message.content);
    return CATEGORIES.includes(answer?.category) ? answer.category : "other";
  } catch {
    return null;
  }
}

// A request ("I need") filled in from the few words its maker typed for what
// they are looking for: which category it is in, and a few lines saying it
// out — the brain beside those words on the form.
const WANTED = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    description: { type: "string" },
  },
  required: ["category", "description"],
  additionalProperties: false,
};

const REQUEST = `rab is a marketplace where people rent out what they have: things, places, and somebody's time and skill. People also post requests there, saying what they are looking for so that whoever has one can offer it.

Every request has one of these categories: ${CATEGORIES.join(", ")}.

You are given the few words somebody typed for what they are looking for. Answer with:
- category: the one category that fits what is wanted, exactly as written above; "other" where none fits. Do not stretch a category to cover something it is not.
- description: two or three plain sentences, in the first person, saying what is wanted and what somebody offering one would want to know it is for. Only what follows from the words given — no price, no dates, no place, no contact details, nothing invented about the person.

Write the description in the language you are asked for.`;

// { category, description }, or null where the model would not give one.
export async function describeRequest(title, language) {
  if (!title) return null;
  client ??= new OpenAI();
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_schema", json_schema: { name: "request", strict: true, schema: WANTED } },
    messages: [
      { role: "system", content: REQUEST },
      { role: "user", content: `Looking for: ${title}\n\nWrite in ${LANGUAGES[language] ?? LANGUAGES.en}.` },
    ],
  });
  const message = completion.choices[0]?.message;
  if (!message || message.refusal || !message.content) return null;
  try {
    const answer = JSON.parse(message.content);
    return {
      category: CATEGORIES.includes(answer?.category) ? answer.category : "other",
      description: String(answer?.description ?? "").trim(),
    };
  } catch {
    return null;
  }
}

export { OpenAI };
