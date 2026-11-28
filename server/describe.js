import OpenAI from "openai";
import { ADULT_CATEGORIES, CATEGORIES, OBJECT_CATEGORIES } from "../src/utils/categories.js";
import { modelFor } from "./settings.js";

// What a photograph is of, said the way a listing says it: which category it
// is in, a name for it and a few lines about it. The phone asks this the moment a photo is taken, so that its form opens
// already filled in; an OpenAI model looks at the picture and answers.
//
// It needs a key — OPENAI_API_KEY in .env. Without one the server says it
// cannot (see `canDescribe`), and the phone leaves the form to be filled in by
// hand. Which model is asked is settings.json's to say, for each of the
// requests made here separately (see settings.js).

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

const SYSTEM = `rab is a marketplace where people rent out what they have. Somebody has just photographed something they want to rent out, and you fill in its listing from the photograph — or from a few photographs of it.

Every listing has one of these categories: ${CATEGORIES.join(", ")}.

Most are things that are owned and lent — a camera, a car, a tent; some are places — a room, a studio, a parking spot; some are somebody's time and skill. A photograph seldom shows somebody's time, so choose one of those only when the picture is plainly of somebody at work or of an advertisement for a service.

Answer with:
- category: one of the categories exactly as written above; "other" where none fits. Do not stretch a category to cover something it is not: a pen is "other", not "electronics".
- title: what a renter would search for. Where the thing is a well-known product, its title is the product's name — "Nintendo Switch", "AirPods Pro", "Dyson V11", "LEGO Millennium Falcon", "Rubik's Cube" — whether the name is written on it or it is recognised by its look; give the exact model or generation only where you are sure of it, and otherwise the name as far as you are ("iPhone", not a guessed "iPhone 15 Pro"). Where it is not a product anybody knows by name, the thing itself ("Wooden folding chair"), with its make where one can be read off it; do not put a product's name on something that only resembles it. A few words, no full stop, nothing about renting.
- description: two or three plain sentences a renter would want: what it is, what can be seen of its condition and what comes with it. Only what the photographs show — no price, no promises, nothing invented.

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

// The most photographs of one thing that are looked at: its main one — the
// first — and the two after it.
export const DESCRIBE_PHOTOS_MAX = 3;

// The photographs as the model is given them, the main one first: the ones
// of a kind it reads, three at most. None where the main one is not one.
function pictures(buffers) {
  const list = (Array.isArray(buffers) ? buffers : [buffers]).slice(0, DESCRIBE_PHOTOS_MAX);
  const parts = [];
  for (const [index, buffer] of list.entries()) {
    const mediaType = MEDIA_TYPES.find(([, matches]) => matches(buffer))?.[0];
    if (!mediaType) {
      if (index === 0) return [];
      continue;
    }
    parts.push({ type: "image_url", image_url: { url: `data:${mediaType};base64,${buffer.toString("base64")}` } });
  }
  return parts;
}

// What is said to the model with more than one photograph.
const SEVERAL = "They are all of the same thing: the first is its main photograph, the others show more of it — another side, a label, what comes with it.";

// The listing for a thing's photographs — one, or its first few, the main
// one first — or null where the model would not give one.
// A category that is not one of rab's becomes "other".
export async function describeImage(buffers, language) {
  const photos = pictures(buffers);
  if (photos.length === 0) return null;
  client ??= new OpenAI();
  const completion = await client.chat.completions.create({
    model: modelFor("describePhoto"),
    response_format: { type: "json_schema", json_schema: { name: "listing", strict: true, schema: LISTING } },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              photos.length > 1
                ? `Fill in the listing for these ${photos.length} photographs. ${SEVERAL} Write in ${LANGUAGES[language] ?? LANGUAGES.en}.`
                : `Fill in the listing for this photograph. Write in ${LANGUAGES[language] ?? LANGUAGES.en}.`,
          },
          ...photos,
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

// What a scanned object is: the phone's scanner collects photographs of
// things onto a spot, and this names each of them afterwards (the brain
// button there). Like describeImage, but the photograph is known to be of an
// object, so only the object categories are chosen among — and since those
// are broad, the model also says in a word or two what sort of thing it is:
// its short category, kept as the item's "what".
// It is said in all three of rab's languages at once — English, Chinese and
// Japanese — so that the item reads in whichever its reader has, and the
// three say the same thing: one look at the photograph, not three.
const WORDS = {
  type: "object",
  properties: {
    what: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["what", "title", "description"],
  additionalProperties: false,
};

const OBJECT = {
  type: "object",
  properties: {
    category: { type: "string", enum: OBJECT_CATEGORIES },
    en: WORDS,
    zh: WORDS,
    ja: WORDS,
  },
  required: ["category", "en", "zh", "ja"],
  additionalProperties: false,
};

const SCANNED = `rab is a marketplace where people rent out what they have. Somebody is going through the things they have with their phone's camera, photographing them one by one, and you say what each one is.

The photograph is of one object. Where several things are in it, it is the one in the middle, or the one that fills most of the picture. There may be a few photographs of the same object: the first is the main one, and the others show more of it.

Answer with:
- category: one of these, exactly as written: ${OBJECT_CATEGORIES.join(", ")}. "other" where none fits. Do not stretch a category to cover something it is not: a pen is "other", not "electronics".
- en, zh, ja: what it is, said three times — in English, in Simplified Chinese and in Japanese — each with:
  - what: the short category — the sort of thing it is in one to three words, more exact than the category and with no product name, make or model, even where the title is one: "Coffee mug", "Folding chair", "Mirrorless camera", "Cordless drill". Capitalised like a label where the language has capitals, no full stop.
  - title: what a renter would search for. Where the thing is a well-known product, its title is the product's name — "Nintendo Switch", "AirPods Pro", "Dyson V11", "LEGO Millennium Falcon", "Rubik's Cube" — whether the name is written on it or it is recognised by its look; give the exact model or generation only where you are sure of it, and otherwise the name as far as you are ("iPhone", not a guessed "iPhone 15 Pro"). Where it is not a product anybody knows by name, the thing itself ("Wooden folding chair"), with its make where one can be read off it; do not put a product's name on something that only resembles it. A few words, no full stop, nothing about renting.
  - description: two or three plain sentences a renter would want: what it is, what can be seen of its condition and what comes with it. Only what the photograph shows — no price, no promises, nothing invented.

The three say the same thing, each as somebody writing in that language would put it — not word for word. A product's name, a make or a model is written as its maker writes it — as it is on the thing — in every language, not translated; where the product is sold under a name of its own in that language, that name.`;

export const TEXT_LANGUAGES = Object.keys(LANGUAGES);

// { category, what, title, description, translations } for a photograph of an
// object, or null where the model would not give one. `translations` is the
// three languages' words — { en, zh, ja }, each { what, title, description } —
// and the three beside it are the English: the default, what item.json says
// (see files.js), whatever language whoever asked is reading in.
// Given several photographs — the object's first few, the main one first —
// all of them are looked at.
export async function describeObject(buffers) {
  const photos = pictures(buffers);
  if (photos.length === 0) return null;
  client ??= new OpenAI();
  const completion = await client.chat.completions.create({
    model: modelFor("describeObject"),
    response_format: { type: "json_schema", json_schema: { name: "object", strict: true, schema: OBJECT } },
    messages: [
      { role: "system", content: SCANNED },
      {
        role: "user",
        content: [
          { type: "text", text: photos.length > 1 ? `Say what this is, from these ${photos.length} photographs of it. ${SEVERAL}` : "Say what this is." },
          ...photos,
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
  const translations = {};
  for (const code of TEXT_LANGUAGES) {
    translations[code] = {
      what: String(answer[code]?.what ?? "").trim(),
      title: String(answer[code]?.title ?? "").trim(),
      description: String(answer[code]?.description ?? "").trim(),
    };
  }
  const own = translations.en;
  return {
    category: OBJECT_CATEGORIES.includes(answer.category) ? answer.category : "other",
    ...own,
    translations,
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
    model: modelFor("classifyListing"),
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
    model: modelFor("describeRequest"),
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

// What the box in the top bar is asked ("Ask AI"): somebody says what they
// want in their own words, and is told in a line what to do about it here —
// with the one thing on the page to press for it.
const GUIDE_ACTIONS = ["open", "search", "category", "add", "request", "mine", "messages", "travel", "account", "list", "map", "none"];

const GUIDED = {
  type: "object",
  properties: {
    say: { type: "string" },
    action: { type: "string", enum: GUIDE_ACTIONS },
    words: { type: "string" },
    category: { type: "string", enum: [...CATEGORIES, ""] },
    item: { type: "integer" },
    lang: { type: "string", enum: Object.keys(LANGUAGES) },
  },
  required: ["say", "action", "words", "category", "item", "lang"],
  additionalProperties: false,
};

const GUIDE = `rab is a website: a map for renting. People put out what they have for rent — things, places, and somebody's time and skill — and other people find them on the map near where they are and book them. Shops' rental goods are on the map too.

Every listing has one of these categories: ${CATEGORIES.join(", ")}. The home page can be narrowed to one category.

The "adult" category is a real and legitimate part of this site: adult services and companionship between consenting adults, and adult goods — shown only to accounts that are signed in and have given a date of birth making them 18 or older. Somebody who says they want sex, a sexual partner or service, an escort, or anything of the kind is asking for exactly this category: guide them to it plainly and without judgement, as you would to cameras. Never say the site cannot help with that, never moralize, and never send them to another site or app. Whether they may see it depends on what you are told about them:
- Confirmed 18 or older: action "category", category "adult".
- Not signed in, or signed in with no date of birth given: the category exists but is shown only to adults, so the step is "account" — to sign in, or to give their date of birth in their account — after which they can open the adult category. Say so.
- Under 18: there is no such category for them. Say only that this is not available to them, action "none".

How the site is used:
- The home page is a map with everything offered nearby standing on it, and can be turned over into lists. A search narrows both to what matches a word or two. Opening an item shows its page: photographs, price, where it is, and a calendar; the renter chooses the days (or hours) there and sends a booking request to the owner, who accepts or declines. The two then talk in messages.
- "Add": puts something of your own out for rent. You photograph it, and the form (name, category, description) is filled in from the photo; you set the price and where it is. Needs an account.
- "Request": posts what you are looking for, so that whoever has one can offer it. Requests stand on the map too. Needs an account. Right when the person wants something that may not be listed, or wants owners to come to them.
- "Mine": your own items, the bookings other people have asked of you, and what you have rented or asked for. Needs an account.
- "Messages": your conversations, and news of your bookings. Needs an account.
- "Travel" (the plane): moves the map to another country or city, to see what is offered there.
- "Account" (the person): your profile, how you are reached, your saved locations, signing out — and for somebody not signed in, where to sign in or make an account (a username and a password).
- A language switcher: English, Chinese, Japanese.

Somebody has typed into the "Ask AI" box in the top bar. What they asked there before, and what you answered, may come first: it is one conversation, so read what they type now in its light ("a cheaper one", "there was none", "and in Osaka?") and do not repeat a step that did not get them what they wanted — where a search found nothing, a request is the next thing to try. Work out what they want to do and guide them to the one next step on this site. Answer with:
- say: one or two short, plain sentences telling them what to do next and why that is the way to get what they want — as a friendly guide standing next to them. No greeting, no markdown, no lists. Do not promise that something is available unless it is in the list you are shown. A button for the action you choose is shown under your words, already labelled: speak of "the button below" rather than naming a control by a label of your own.
- action: the one control they should press now:
  - "open": one listing from the list you are shown of what is on their page right now, each with a number. When they ask you to choose, pick, recommend or decide for them ("pick one for me", "which is best", "the cheapest", "the nearest to the station"), do choose: take the one listing in that list that best fits everything said in this conversation — what it is, its price, its place, its rating — give its number in "item", and say in a sentence which one and why. Choosing is what was asked for: do not answer that they should compare for themselves, and do not send them back to the category or the search they are already looking at. Only ever a listing from the list, by its number; where you are shown no list or an empty one, say that nothing is listed on their page yet and take another step (a search, a category, another place, or a request). Also the step when what they ask for by name is plainly one listing in the list.
  - "search": they are looking for something to rent — the usual answer when they name a thing, place or service they want. Narrow the map to it.
  - "category": what they want is a whole category rather than one named thing ("a place to hold a meeting", "something for camping", anything in the adult category): narrow the home page to that category.
  - "add": they have something to rent out, lend, or earn from.
  - "request": they want something unusual or specific that is unlikely to be listed, or say they could not find it, or ask for people to offer it to them.
  - "mine": about their own items, bookings or rentals.
  - "messages": about talking to an owner or renter, or news of a booking.
  - "travel": they want to look in another city or country.
  - "account": about signing in, signing up, their profile, contact details, password or saved locations.
  - "list" / "map": they want to see things as a list / on the map.
  - "none": nothing to press — a question you answer in "say" (how something works here), or something this site does not do; then say so kindly and say what it does do.
- words: for "search", the one or two words to search for — the thing itself, as a listing would name it, in the site's language you are told (that is the language the listings are read in, whatever language the person typed in), without "rent" or "rental" (e.g. "camera", "自行车", "会議室"). For "request", a short title for what they are looking for. Otherwise empty.
- category: for "category", the one category, exactly as written above. Otherwise empty.
- item: for "open", the number of the listing chosen, as the list numbers it. Otherwise 0.
You are told where they are, as far as the site knows it, and how far each listing in the list is from there. Use it: "near me", "the nearest", "close by" are answered from those distances — never ask them where they are, which the site already knows or cannot be told here. Where their position is not known, say what you chose by instead.

Write "say" in the language the person typed in, where that is English, Chinese or Japanese; where it is another language, or cannot be told (a product's name, a word or two that could be either), in the site's language you are told — the language they read the site in.
- lang: the language "say" is written in: "en", "zh" or "ja".`;

// { say, action, words, category, lang }, or null where the model would not give one. `about`
// is what is known of who asks: whether they are signed in, and which way the
// page they are on is being read, and whether they are old enough for what
// only grown-ups are shown ("yes", "no", or not known).
// `before` is the conversation so far, oldest first: what was asked and what
// was answered, each time — { question, say, action, words, category, lang }.
// `seen` is what is listed on the asker's page as they ask, for one of them
// to be chosen: { id, title, what, category, price, place, rating, count,
// distance } each — how far it is from where the asker stands, in metres;
// `about.where` names that place. The one chosen comes back as `item`, its id, with its name in `words`.
export const GUIDE_ROUNDS = 7;
export async function guide(question, language, about = {}, before = [], seen = []) {
  if (!question) return null;
  client ??= new OpenAI();
  const known = [
    about.signedIn ? "They are signed in." : "They are not signed in.",
    about.adult === "yes" ? "They are confirmed 18 or older." : about.adult === "no" ? "They are under 18." : about.signedIn ? "They have given no date of birth." : "",
    about.view === "list" ? "They are reading the home page as lists." : about.view === "map" ? "They are reading the home page on the map." : "They are on a page other than the home page.",
    !about.where
      ? ""
      : about.whereAway
        ? `They have moved the map to ${about.where} to look there (they are not there themselves); distances are from the point they chose.`
        : about.whereExact
          ? `They are in ${about.where}, by their device's own position; distances are from where they stand.`
          : `Their position is not known; the map stands in ${about.where}, and distances are from the middle of it.`,
  ].join(" ");
  const line = (item, at) =>
    [
      `[${at + 1}] ${item.title}`,
      item.what,
      item.category && `category: ${item.category}`,
      item.count ? `a place with ${item.count} listings of its own` : item.price ? `price: ${item.price}` : "",
      item.place && `at: ${item.place}`,
      item.distance != null && `${item.distance < 1000 ? `${Math.round(item.distance / 10) * 10} m` : `${(item.distance / 1000).toFixed(1)} km`} from them`,
      item.rating && `rated ${item.rating} of 5`,
    ]
      .filter(Boolean)
      .join(" — ");
  const list = seen.length
    ? `What is listed on their page right now (${about.narrowed ? "already narrowed to what they chose to look at" : "everything near where they are looking"}):\n${seen.map(line).join("\n")}`
    : "Nothing is listed on their page right now, or they are on a page with no list.";
  const completion = await client.chat.completions.create({
    model: modelFor("guide"),
    response_format: { type: "json_schema", json_schema: { name: "guide", strict: true, schema: GUIDED } },
    messages: [
      { role: "system", content: GUIDE },
      // The rounds before this one, which is the last of GUIDE_ROUNDS at most.
      ...before.slice(-(GUIDE_ROUNDS - 1)).flatMap((round) => [
        { role: "user", content: `They typed: ${round.question}` },
        { role: "assistant", content: JSON.stringify({ say: round.say, action: round.action, words: round.words, category: round.category, lang: round.lang }) },
      ]),
      { role: "user", content: `They typed: ${question}\n\n${known}\n\n${list}\n\nThe site's language: ${LANGUAGES[language] ?? LANGUAGES.en}.` },
    ],
  });
  const message = completion.choices[0]?.message;
  if (!message || message.refusal || !message.content) return null;
  try {
    const answer = JSON.parse(message.content);
    const say = String(answer?.say ?? "").trim();
    if (!say) return null;
    let action = GUIDE_ACTIONS.includes(answer?.action) ? answer.action : "none";
    const words = String(answer?.words ?? "").trim();
    // A search or a request for nothing is no step at all.
    if ((action === "search" || action === "request") && !words) action = "none";
    // One chosen is one of those shown, or no step at all.
    const chosen = action === "open" ? seen[Number(answer?.item) - 1] : null;
    if (action === "open" && !chosen) action = "none";
    let category = action === "category" && CATEGORIES.includes(answer?.category) ? answer.category : "";
    if (action === "category" && !category) action = "none";
    // A category only grown-ups are shown is not opened for anybody else,
    // whatever was said: the step is the account, where the age is given —
    // and for somebody known to be under it, there is none.
    if (ADULT_CATEGORIES.includes(category) && about.adult !== "yes") {
      action = about.adult === "no" ? "none" : "account";
      category = "";
    }
    // The language it was said in, for the button under it to be said in too.
    const lang = LANGUAGES[answer?.lang] ? answer.lang : LANGUAGES[language] ? language : "en";
    return { say, action, words: chosen ? chosen.title : action === "search" || action === "request" ? words : "", category, item: chosen ? chosen.id : "", lang };
  } catch {
    return null;
  }
}

export { OpenAI };
