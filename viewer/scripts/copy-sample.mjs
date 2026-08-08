// Build step: copy every clip JSON in data/sample_clip into the viewer's
// public/clips/ folder and emit a clips.json index, so the production build
// ships with the same multi-clip selector the dev server exposes.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverClips, clipPath } from "./clips.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clipDir = resolve(__dirname, "../../data/sample_clip");
const outDir = resolve(__dirname, "../public/clips");
const indexDst = resolve(__dirname, "../public/clips.json");

// Start from a clean clips/ folder so removed clips do not linger.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const clips = discoverClips(clipDir);
if (clips.length === 0) {
  console.warn("warning: no clips found in data/sample_clip — viewer will have an empty selector");
}

for (const { id } of clips) {
  const src = clipPath(clipDir, id);
  const dst = resolve(outDir, `${id}.json`);
  try {
    copyFileSync(src, dst);
    console.log(`copied ${src} -> ${dst}`);
  } catch {
    console.warn(`warning: could not copy ${src}`);
  }
}

writeFileSync(indexDst, JSON.stringify(clips), "utf-8");
console.log(`wrote ${indexDst} (${clips.length} clips)`);
