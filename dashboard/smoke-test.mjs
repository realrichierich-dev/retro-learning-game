// Headless real-browser smoke test: loads the dashboard and fails loudly
// on any console error or uncaught page error. Exists specifically
// because static checks (tsc, vite build) cannot catch a runtime-only
// crash -- which is exactly how a real bug was found and fixed here: the
// app rendered a totally blank page in a real browser (React's hook
// dispatcher going null from a duplicate-React-copies problem in a since-
// removed dependency) while `npm run build` and `tsc --noEmit` both
// passed clean. See git history / dashboard/README.md for the story.
//
// Requires the dev server already running (npm run dev) and Playwright's
// Chromium installed (npx playwright install chromium, one-time).
//
// Usage: node smoke-test.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5174";

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
});
page.on("pageerror", (err) => errors.push(`[uncaught] ${err.message}`));
page.on("requestfailed", (req) => errors.push(`[request failed] ${req.url()} -- ${req.failure()?.errorText}`));

await page
  .goto(url, { waitUntil: "networkidle", timeout: 15000 })
  .catch((e) => errors.push(`[navigation failed] ${e.message}`));

await page.waitForTimeout(1500);

const rootHtml = await page.evaluate(() => document.getElementById("root")?.innerHTML ?? "");
await browser.close();

if (errors.length > 0) {
  console.error(`FAIL -- ${errors.length} error(s) loading ${url}:\n`);
  console.error(errors.join("\n"));
  process.exit(1);
}

if (!rootHtml.trim()) {
  console.error(`FAIL -- #root is empty at ${url} (blank page, no JS error captured -- check manually)`);
  process.exit(1);
}

console.log(`PASS -- ${url} rendered with no console/page errors (${rootHtml.length} chars in #root)`);
