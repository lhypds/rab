import crypto from "node:crypto";

// Mail rab sends out, which is one kind of mail: the code that proves an
// address is somebody's before an account is opened with it. Sent through
// Amazon SES (the v2 API), with the request signed by hand — Signature
// Version 4 is a page of hashing, and not worth a dependency the size of the
// AWS SDK for the one call.
//
// What it needs, in .env:
//   AWS_REGION              the region SES is set up in, e.g. ap-northeast-1
//   AWS_ACCESS_KEY_ID       a key allowed ses:SendEmail
//   AWS_SECRET_ACCESS_KEY
//   AWS_SESSION_TOKEN       (only with temporary credentials)
//   RAB_MAIL_FROM           the address it is sent from, verified in SES —
//                           "rab <no-reply@example.com>" or a bare address

const settings = () => ({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "",
  key: process.env.AWS_ACCESS_KEY_ID || "",
  secret: process.env.AWS_SECRET_ACCESS_KEY || "",
  token: process.env.AWS_SESSION_TOKEN || "",
  from: process.env.RAB_MAIL_FROM || "",
});

// Whether there is anything to send with. Without it a server that is being
// worked on says the mail on its console instead (see index.js); one that is
// serving people refuses, since a code nobody receives opens no account.
export function mailConfigured() {
  const { region, key, secret, from } = settings();
  return Boolean(region && key && secret && from);
}

const sha256 = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value, "utf8").digest();

// One plain-text mail to one address. Throws where SES says no, with what it
// said, so the caller can tell the reader the mail did not go.
export async function sendMail({ to, subject, text }) {
  const { region, key, secret, token, from } = settings();
  if (!mailConfigured()) throw new Error("Mail is not configured");

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: text, Charset: "UTF-8" } },
      },
    },
  });

  // 20261123T101500Z, and the date alone for the key the signature is made with.
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const headers = { "content-type": "application/json", host, "x-amz-date": stamp };
  if (token) headers["x-amz-security-token"] = token;

  // The request as SES will see it, in the order and the shape the signature
  // is defined over: headers by name, lower case, each on a line.
  const names = Object.keys(headers).sort();
  const canonical = [
    "POST",
    path,
    "",
    ...names.map((name) => `${name}:${headers[name]}`),
    "",
    names.join(";"),
    sha256(body),
  ].join("\n");
  const scope = `${date}/${region}/ses/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "ses"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");

  const response = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const said = await response.text().catch(() => "");
    throw new Error(`SES refused the mail (${response.status}): ${said.slice(0, 300)}`);
  }
}
