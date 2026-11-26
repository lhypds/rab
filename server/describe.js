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

export { OpenAI };
