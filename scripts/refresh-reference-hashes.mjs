#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "reference");
const output = join(root, "SHA256SUMS");
const files = [];

async function collect(path) {
  const details = await stat(path);
  if (details.isDirectory()) {
    for (const name of await readdir(path)) await collect(join(path, name));
  } else if (path !== output) {
    files.push(path);
  }
}

await collect(root);
files.sort();
const lines = [];
for (const path of files) {
  const hash = createHash("sha256").update(await readFile(path)).digest("hex");
  lines.push(`${hash}  ${relative(root, path).replaceAll("\\", "/")}`);
}
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Reference hashes refreshed: ${files.length} files.`);

