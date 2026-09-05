import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const databasePlaceholder = "00000000-0000-0000-0000-000000000000";
const accountPlaceholder = "00000000000000000000000000000000";
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

if (!accountId || accountId === accountPlaceholder) {
  throw new Error("Missing CLOUDFLARE_ACCOUNT_ID GitHub secret.");
}

if (!databaseId || databaseId === databasePlaceholder) {
  throw new Error("Missing CLOUDFLARE_D1_DATABASE_ID GitHub secret.");
}

const configPath = resolve("wrangler.jsonc");
let config = await readFile(configPath, "utf8");

if (config.includes(accountPlaceholder)) {
  config = config.replaceAll(accountPlaceholder, accountId);
}

if (config.includes(databasePlaceholder)) {
  config = config.replaceAll(databasePlaceholder, databaseId);
}

await writeFile(configPath, config);
console.log("Patched wrangler.jsonc with production Cloudflare ids.");
