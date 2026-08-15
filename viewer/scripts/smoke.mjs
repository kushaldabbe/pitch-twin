// Headless smoke test: load the built viewer, surface JS/console errors, confirm
// the canvas renders (not blank), and verify the moments panel populates for a
// clip that has detected moments.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const URL = "http://localhost:4173/#clip=Spain_France_Euro2024";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

const exe = findChrome();
if (!exe) {
  console.error("No Chrome/Edge found; set CHROME_PATH");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: "new",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
const consoleErrors = [];
const notFound = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`CONSOLE: ${m.text()}`);
});
page.on("response", (r) => {
  if (r.status() === 404) notFound.push(`${r.status()} ${r.url()}`);
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (u.includes(".json") || u.includes(".glb")) {
    errors.push(`REQFAIL: ${u} ${r.failure()?.errorText}`);
  }
});

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
} catch (e) {
  errors.push(`GOTO: ${e.message}`);
}
const rafFires = await page.evaluate(
  () => new Promise((res) => {
    const t = setTimeout(() => res(false), 1500);
    requestAnimationFrame(() => {
      clearTimeout(t);
      res(true);
    });
  }),
);
console.log(`rafFires: ${rafFires}`);
await new Promise((r) => setTimeout(r, 7000));

const stats = await page.evaluate(() => ({
  canvas: !!document.querySelector("canvas"),
  momentButtons: document.querySelectorAll("#moments .mom").length,
  clip: document.getElementById("clip")?.value ?? "?",
  momentPanelTitle: document.querySelector("#moments .title")?.textContent ?? "?",
}));

await page.screenshot({ path: "smoke.png" });
await browser.close();

console.log("\n=== NOT FOUND ===");
console.log(notFound.length ? notFound.join("\n") : "(none)");
console.log("\n=== ERRORS ===");
console.log(errors.length ? errors.join("\n") : "(none)");
console.log("\n=== CONSOLE ERRORS ===");
console.log(consoleErrors.length ? consoleErrors.slice(0, 10).join("\n") : "(none)");
console.log("\n=== RENDER STATS ===");
console.log(JSON.stringify(stats, null, 2));
console.log("\nscreenshot: viewer/smoke.png");
