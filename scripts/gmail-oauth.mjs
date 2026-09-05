#!/usr/bin/env node

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command === "url") {
  required(args, ["client-id", "redirect-uri"]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", args["client-id"]);
  url.searchParams.set("redirect_uri", args["redirect-uri"]);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", SCOPES.join(" "));
  console.log(url.toString());
} else if (command === "token") {
  required(args, ["client-id", "client-secret", "redirect-uri", "code"]);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args["client-id"],
      client_secret: args["client-secret"],
      redirect_uri: args["redirect-uri"],
      code: args.code,
      grant_type: "authorization_code",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Token exchange failed: ${res.status}`);
    console.error(text);
    process.exit(1);
  }
  const data = JSON.parse(text);
  if (!data.refresh_token) {
    console.error("No refresh_token returned. Re-run the URL step with prompt=consent and access_type=offline, then grant consent again.");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token}`);
} else {
  console.error(`Usage:
  node scripts/gmail-oauth.mjs url --client-id <id> --redirect-uri <uri>
  node scripts/gmail-oauth.mjs token --client-id <id> --client-secret <secret> --redirect-uri <uri> --code <code>`);
  process.exit(1);
}

function parseArgs(values) {
  const out = { _: [] };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) {
      out._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(values, keys) {
  const missing = keys.filter((key) => !values[key]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.join(", ")}`);
    process.exit(1);
  }
}
