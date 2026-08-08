// Shared clip discovery + labelling. Used by the Vite dev middleware and the
// production build script so dev and build see the same clip list.
import { readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const LABELS = {
  real: "Broadcast clip (football_clip)",
  synthetic: "Synthetic demo",
  PSG_Inter_UCL_Final: "PSG v Inter — UCL Final",
  RealMadrid_Barcelona: "Real Madrid v Barcelona",
  Spain_France_Euro2024: "Spain v France — Euro 2024",
  England_Uruguay: "England v Uruguay",
  Brazil_Scotland_WC2026: "Brazil v Scotland — WC 2026",
};

export function labelFor(id) {
  return LABELS[id] ?? id.replace(/_/g, " ");
}

// Return [{id, name}] for every <id>.json in ``dir``. Match clips are listed
// first (alphabetical); the legacy real/synthetic clips go last.
export function discoverClips(dir) {
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const rank = (x) => (x === "synthetic" ? 2 : x === "real" ? 1 : 0);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({ id, name: labelFor(id) }));
}

export function clipPath(dir, id) {
  return resolve(dir, `${id}.json`);
}
