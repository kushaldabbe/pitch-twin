import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const realPath = resolve(__dirname, "../data/sample_clip/real.json");
const synthPath = resolve(__dirname, "../data/sample_clip/synthetic.json");

// Dev-only: serve the real CV pipeline output if present, else the synthetic
// clip, so the viewer always has data and reflects the latest regeneration.
const serveLiveSample = () => ({
  name: "serve-live-sample",
  configureServer(server) {
    server.middlewares.use("/sample.json", (_req, res) => {
      const path = existsSync(realPath) ? realPath : synthPath;
      try {
        const data = readFileSync(path);
        res.setHeader("Content-Type", "application/json");
        res.end(data);
      } catch {
        res.statusCode = 500;
        res.end("sample.json not found — run the synthetic generator or the pipeline first");
      }
    });
  },
});

export default defineConfig({
  plugins: [serveLiveSample()],
  base: "./",
  server: { open: true, port: 5173 },
});
