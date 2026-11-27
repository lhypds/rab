// The codes a phone number is dialled with from abroad, +81 for Japan: which
// country has which, for the list a phone number's code is chosen from, and
// for the one a new number starts with — the reader's own country's.
//
// Written as the country's two letters and its code, a country to a word. A
// code several countries share (+1, +7) is one row of the list, named after
// the first of them here.
const CODES =
  "JP81 CN86 KR82 TW886 HK852 MO853 US1 CA1 GB44 AU61 NZ64 SG65 MY60 TH66 VN84 PH63 ID62 IN91 PK92 BD880 LK94 NP977 " +
  "MM95 KH855 LA856 BN673 MN976 KZ7 RU7 UA380 BY375 PL48 CZ420 SK421 HU36 RO40 BG359 GR30 TR90 CY357 " +
  "DE49 FR33 IT39 ES34 PT351 NL31 BE32 LU352 CH41 AT43 IE353 DK45 SE46 NO47 FI358 IS354 EE372 LV371 LT370 " +
  "SI386 HR385 RS381 BA387 ME382 MK389 AL355 MD373 GE995 AM374 AZ994 MT356 " +
  "IL972 SA966 AE971 QA974 KW965 BH973 OM968 JO962 LB961 IQ964 IR98 EG20 MA212 DZ213 TN216 LY218 " +
  "ZA27 NG234 KE254 GH233 ET251 TZ255 UG256 SN221 CI225 CM237 AO244 MZ258 ZM260 ZW263 RW250 MU230 " +
  "MX52 BR55 AR54 CL56 CO57 PE51 VE58 EC593 BO591 PY595 UY598 CR506 PA507 GT502 SV503 HN504 NI505 CU53 DO1 JM1 " +
  "UZ998 KG996 TJ992 TM993 AF93 MV960 BT975 FJ679 PG675 NC687 PF689";

const byCountry = new Map();
const byCode = new Map();
for (const word of CODES.split(" ")) {
  const country = word.slice(0, 2);
  const code = `+${word.slice(2)}`;
  byCountry.set(country, code);
  if (!byCode.has(code)) byCode.set(code, country);
}

// The code a number starts with before anybody has chosen one.
export const DEFAULT_DIAL_CODE = "+81";

// A country's code, by its two letters — the default where it is not known.
export function dialCodeOf(country) {
  return byCountry.get(String(country ?? "").toUpperCase()) ?? DEFAULT_DIAL_CODE;
}

// The codes to choose from, each with the country it is named after, in the
// reader's language: [{ code, name }], in the order written above.
export function dialCodes(lang) {
  let names = null;
  try {
    names = new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    // A browser without the names lists the two letters.
  }
  return [...byCode].map(([code, country]) => ({ code, name: names?.of(country) ?? country }));
}

// A number written with its code in front, +819012345678, as the code and the
// rest — the longest code it starts with. Null where it starts with none.
export function splitDialCode(value) {
  const written = String(value ?? "");
  if (!written.startsWith("+")) return null;
  for (let length = 5; length >= 2; length -= 1) {
    const code = written.slice(0, length);
    if (byCode.has(code)) return { code, value: written.slice(length) };
  }
  return null;
}

// A number as it is dialled from anywhere: the code, and the number without
// the 0 it is dialled with at home — which is dropped everywhere but Italy.
export function dialled(code, value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return `${code}${code === "+39" ? digits : digits.replace(/^0/, "")}`;
}

// Where pressing a way of reaching somebody goes: a phone number starts a
// call, an email address opens a letter to it — about `subject`, where one is
// given — a LINE ID opens it in LINE, a WhatsApp number a chat with it, and an
// address, a WeChat ID or anything else goes nowhere (null).
export function contactHref(contact, subject = "") {
  if (contact?.type === "phone") {
    return `tel:${contact.code ? dialled(contact.code, contact.value) : String(contact.value).replace(/[^\d+]/g, "")}`;
  }
  if (contact?.type === "email") {
    return `mailto:${contact.value}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  }
  if (contact?.type === "line" && contact.value) {
    return `https://line.me/ti/p/~${encodeURIComponent(contact.value.replace(/^@?/, ""))}`;
  }
  // WhatsApp is reached by a number in full, its country code in front.
  if (contact?.type === "whatsapp" && /^\+?[\d\s()-]{6,}$/.test(contact.value ?? "")) {
    return `https://wa.me/${contact.value.replace(/\D/g, "")}`;
  }
  return null;
}
