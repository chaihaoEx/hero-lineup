#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "content");
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.files)) throw new Error("manifest.files must be an array");

let totalBytes = 0;
for (const expected of manifest.files) {
  if (typeof expected.path !== "string" || expected.path.includes("\\")) {
    throw new Error(`non-portable manifest path: ${String(expected.path)}`);
  }
  const path = normalize(join(root, expected.path));
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`unsafe manifest path: ${expected.path}`);
  const details = await stat(path);
  if (!details.isFile() || details.size !== expected.size) throw new Error(`size mismatch: ${expected.path}`);
  const bytes = await readFile(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected.sha256) throw new Error(`checksum mismatch: ${expected.path}`);
  totalBytes += bytes.byteLength;
}

if (manifest.files.some((entry) => entry.path === "manifest.json")) {
  throw new Error("manifest must not include itself");
}
console.log(`Content verified: ${manifest.files.length} files, ${totalBytes} bytes.`);
