import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// settings.json, beside package.json: what this server is set to do that is
// not a secret and not the build's — so far, which OpenAI model each of its
// AI requests is put to (see describe.js):
//
//   {
//     "models": {
//       "default": "gpt-6.1-terra",   the model of every request not named below
//       "describePhoto": "",          a listing's form filled in from its photograph (the website)
//       "describeObject": "",         a scanned object named in three languages (the iPhone app)
//       "classifyListing": "",        a listing's category chosen from what it says
//       "describeRequest": "",        a request ("I need") filled in from a few words
//       "guide": ""                   what to do next, for what is typed into the bar's "Ask AI"
//     }
//   }
//
// A request left empty, or left out, is put to the default; the default left
// out is the one written here. The file is made from settings.json.example by
// setup.sh (and restart.sh, where it is missing) and is not in git: each
// machine has its own. It is read again whenever it has been changed, so a
// model is switched without the server being started again.

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "settings.json");

const DEFAULT_MODEL = "gpt-6.1-terra";

// The requests a model can be set for.
export const MODEL_TASKS = ["describePhoto", "describeObject", "classifyListing", "describeRequest", "guide"];

let read = { stamp: null, settings: {} };
let complained = null;

// What the file says, or nothing where there is no file or it cannot be
// read — said once in the log for each thing that is wrong with it.
function settings() {
  let stamp;
  try {
    stamp = fs.statSync(FILE).mtimeMs;
  } catch {
    complain("rab: there is no settings.json (copy settings.json.example); the defaults are used");
    return {};
  }
  if (stamp === read.stamp) return read.settings;
  let parsed = {};
  try {
    const value = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
    complained = null;
  } catch (error) {
    complain(`rab: settings.json could not be read (${error.message}); the defaults are used`);
  }
  read = { stamp, settings: parsed };
  return parsed;
}

function complain(message) {
  if (complained === message) return;
  complained = message;
  console.error(message);
}

const named = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

// The model one of the AI requests is put to: the one set for it, or else
// the default one.
export function modelFor(task) {
  const models = settings().models;
  const set = models && typeof models === "object" ? models : {};
  return named(set[task]) ?? named(set.default) ?? DEFAULT_MODEL;
}
