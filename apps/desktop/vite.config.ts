import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFile } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const desktopRoot = process.env.npm_config_local_prefix ?? process.cwd();
const contentCandidates = [
  resolve(process.cwd(), "content"),
  resolve(process.cwd(), "../../content"),
  resolve(desktopRoot, "content"),
  resolve(desktopRoot, "../../content"),
];
const contentRoot = contentCandidates.find((candidate) => existsSync(candidate)) ?? contentCandidates[0];

function offlineContentAssets(): Plugin {
  return {
    name: "offline-content-assets",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const prefix = "/offline-assets/";
        const requestPath = (request.url ?? "").split("?")[0] ?? "";
        if (!requestPath.startsWith(prefix)) {
          next();
          return;
        }
        const relativePath = decodeURIComponent(requestPath.slice(prefix.length));
        const absolutePath = resolve(contentRoot, relativePath);
        if (absolutePath !== contentRoot && !absolutePath.startsWith(`${contentRoot}${sep}`)) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }
        readFile(absolutePath, (error, data) => {
          if (error) {
            if (error.code === "ENOENT") next();
            else next(error);
            return;
          }
          const mimeTypes: Record<string, string> = {
            ".gif": "image/gif",
            ".jpeg": "image/jpeg",
            ".jpg": "image/jpeg",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",
          };
          response.setHeader("Content-Type", mimeTypes[extname(absolutePath).toLowerCase()] ?? "application/octet-stream");
          response.end(data);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [offlineContentAssets(), react()],
  publicDir: false,
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "es2021", minify: "esbuild", sourcemap: true, copyPublicDir: false },
});
