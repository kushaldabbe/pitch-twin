import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(__dirname, "../data/sample_clip/synthetic.json");

// Dev-only: always serve the latest synthetic.json from the data dir so
// regenerating it on the CV side is reflected without copying.
const serveLiveSample = () => ({
  name: "serve-live-sample",
  configureServer(server) {
    server.middlewares.use("/sample.json", (_req, res) => {
      try {
        const data = readFileSync(samplePath);
        res.setHeader("Content-Type", "application/json");
        res.end(data);
      } catch {
        res.statusCode = 500;
        res.end("sample.json not found — run the synthetic generator first");
      }
    });
  },
});

export default defineConfig({
  plugins: [serveLiveSample()],
  base: "./",
  server: { open: true, port: 5173 },
});
