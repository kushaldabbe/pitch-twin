import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { discoverClips, clipPath } from "./scripts/clips.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clipDir = resolve(__dirname, "../data/sample_clip");

// Dev-only: expose the clip index and per-clip JSON so the viewer can list and
// switch matches without a server restart. Paths are relative to match the
// viewer's relative fetches (works with base: "./").
const serveClips = () => ({
  name: "serve-clips",
  configureServer(server) {
    server.middlewares.use("/clips.json", (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(discoverClips(clipDir)));
    });
    // /clips/<id>.json -> the matching file in data/sample_clip. The id is
    // validated against the discovered list to block path traversal.
    server.middlewares.use("/clips", (req, res, next) => {
      const m = typeof req.url === "string" ? req.url.match(/^\/([^/]+)\.json$/) : null;
      if (!m) return next();
      const id = decodeURIComponent(m[1]);
      if (!discoverClips(clipDir).some((c) => c.id === id)) {
        res.statusCode = 404;
        res.end("clip not found");
        return;
      }
      const path = clipPath(clipDir, id);
      if (!existsSync(path)) {
        res.statusCode = 404;
        res.end("clip not found");
        return;
      }
      try {
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(path));
      } catch {
        res.statusCode = 500;
        res.end("could not read clip");
      }
    });
  },
});

export default defineConfig({
  plugins: [serveClips()],
  base: "./",
  server: { open: true, port: 5173 },
});
