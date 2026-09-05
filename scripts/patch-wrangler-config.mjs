import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const placeholder = "00000000-0000-0000-0000-000000000000";
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();

if (!databaseId || databaseId === placeholder) {
  throw new Error("Missing CLOUDFLARE_D1_DATABASE_ID GitHub secret.");
}

const configPath = resolve("wrangler.jsonc");
const config = await readFile(configPath, "utf8");

if (!config.includes(placeholder)) {
  console.log("wrangler.jsonc already has a concrete D1 database_id.");
  process.exit(0);
}

await writeFile(configPath, config.replaceAll(placeholder, databaseId));
console.log("Patched wrangler.jsonc with production D1 database id.");
