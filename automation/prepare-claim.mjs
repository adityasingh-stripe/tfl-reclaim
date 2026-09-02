import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fillConfiguredFields, validateConfiguration } from "./claim-fields.mjs";
import { createBrowserbaseSession, getBrowserbaseDebug, sessionLinks } from "./browserbase.mjs";

const { values } = parseArgs({ options: {
  claim: { type: "string" },
  config: { type: "string", default: "automation/tfl-selectors.example.json" },
  screenshot: { type: "string", default: "artifacts/tfl-claim-review.png" },
  "auth-wait": { type: "string", default: "0" },
  "review-wait": { type: "string", default: "600" },
} });

if (!values.claim) {
  console.error("Usage: npm run prepare:claim -- --claim path/to/claim.json [--auth-wait 120]");
  process.exit(2);
}

const readJson = async path => JSON.parse(await readFile(resolve(path), "utf8"));
const claim = await readJson(values.claim);
const configuration = await readJson(values.config);
validateConfiguration(configuration);

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  throw new Error("playwright-core is not installed");
}

const session = await createBrowserbaseSession({
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
});
const browser = await chromium.connectOverCDP(session.connectUrl);
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();
await page.goto(configuration.startUrl, { waitUntil: "domcontentloaded" });
const debug = await getBrowserbaseDebug(session.id, process.env.BROWSERBASE_API_KEY);
const links = sessionLinks(session, debug);
console.log(JSON.stringify({ sessionId: session.id, ...links }, null, 2));

const authWait = Number(values["auth-wait"]);
if (!Number.isFinite(authWait) || authWait < 0) throw new Error("--auth-wait must be a non-negative number of seconds");
if (authWait) {
  console.log(`Use the debugger URL to log in and navigate to the claim form. Filling starts in ${authWait} seconds.`);
  await page.waitForTimeout(authWait * 1000);
}

const result = await fillConfiguredFields(page, configuration, claim);
const screenshotPath = resolve(values.screenshot);
await mkdir(dirname(screenshotPath), { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });

console.log(JSON.stringify({ sessionId: session.id, ...links, ...result, screenshot: screenshotPath, url: page.url(), submitted: false }, null, 2));
console.log("Stopped before submission. A human must review the screenshot and submit on TfL.");
const reviewWait = Number(values["review-wait"]);
if (!Number.isFinite(reviewWait) || reviewWait < 0) throw new Error("--review-wait must be a non-negative number of seconds");
if (reviewWait) {
  console.log(`Remote browser remains available for human review for ${reviewWait} seconds.`);
  await page.waitForTimeout(reviewWait * 1000).catch(() => {});
}
await browser.close();
