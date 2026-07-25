import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../../data/sample_clip/synthetic.json");
const dst = resolve(__dirname, "../public/sample.json");

mkdirSync(dirname(dst), { recursive: true });
try {
  copyFileSync(src, dst);
  console.log(`copied ${src} -> ${dst}`);
} catch {
  console.warn(`warning: ${src} not found — build will still work, demo will 404`);
}
