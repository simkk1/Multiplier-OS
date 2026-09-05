import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const server = join(dist, "server");

if (!existsSync(src)) {
  throw new Error("Missing src directory");
}

const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
const resolvedDist = resolve(dist);
if (!resolvedDist.startsWith(rootPrefix)) {
  throw new Error("Refusing to remove dist outside project root");
}

await rm(resolvedDist, { recursive: true, force: true });
await mkdir(server, { recursive: true });
await cp(src, server, { recursive: true });

console.log("Built dist/server/index.js");
