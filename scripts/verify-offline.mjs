#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: verify-offline.mjs <path> [path ...]");
  process.exit(2);
}

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
]);
const forbidden = [
  /(?:fetch|EventSource|WebSocket)\s*\(\s*["'`]https?:\/\//gi,
  /\.open\s*\([^,]+,\s*["'`]https?:\/\//gi,
  /(?:src|href)\s*=\s*["']https?:\/\//gi,
  /url\(\s*["']?https?:\/\//gi,
  /wss?:\/\/(?!localhost(?::\d+)?(?:[\s/"';]|$))/gi,
  /https?:\/\/(?:www\.)?cq-zys\.cn/gi,
  /https?:\/\/[^"'`\s)]*googleapis\.com/gi,
  /socket\.io/gi,
];
const allowedFixtureSegments = ["/tests/", "/test/", "/reference/"];
const violations = [];

async function inspect(path) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (details.isDirectory()) {
    for (const entry of await readdir(path)) await inspect(join(path, entry));
    return;
  }
  if (!textExtensions.has(extname(path))) return;
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("/src-tauri/gen/")) return;
  if (allowedFixtureSegments.some((segment) => normalized.includes(segment))) return;
  const value = await readFile(path, "utf8");
  for (const expression of forbidden) {
    expression.lastIndex = 0;
    for (const match of value.matchAll(expression)) {
      const line = value.slice(0, match.index).split("\n").length;
      violations.push(`${normalized}:${line}: ${match[0]}`);
    }
  }
}

for (const root of roots) await inspect(resolve(root));
if (violations.length > 0) {
  console.error("Offline audit failed. Runtime source contains remote endpoints:");
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Offline audit passed for ${roots.length} path(s).`);
