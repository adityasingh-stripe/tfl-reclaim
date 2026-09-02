import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fillConfiguredFields, validateConfiguration } from "./claim-fields.mjs";

const { values } = parseArgs({ options: {
  claim: { type: "string" },
  config: { type: "string", default: "automation/tfl-selectors.example.json" },
  screenshot: { type: "string", default: "artifacts/tfl-claim-review.png" },
  storage: { type: "string" },
  headed: { type: "boolean", default: false },
} });

if (!values.claim) {
  console.error("Usage: npm run prepare:claim -- --claim path/to/claim.json [--headed]");
  process.exit(2);
}

const readJson = async path => JSON.parse(await readFile(resolve(path), "utf8"));
const claim = await readJson(values.claim);
const configuration = await readJson(values.config);
validateConfiguration(configuration);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  throw new Error("Playwright is not installed. Install optional dependencies and a Chromium browser before running this worker.");
}

const browser = await chromium.launch({ headless: !values.headed });
const context = await browser.newContext(values.storage ? { storageState: resolve(values.storage) } : {});
const page = await context.newPage();
await page.goto(configuration.startUrl, { waitUntil: "domcontentloaded" });
const result = await fillConfiguredFields(page, configuration, claim);
const screenshotPath = resolve(values.screenshot);
await mkdir(dirname(screenshotPath), { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });

console.log(JSON.stringify({ ...result, screenshot: screenshotPath, url: page.url(), submitted: false }, null, 2));
console.log("Stopped before submission. A human must review the screenshot and submit on TfL.");
if (values.headed) {
  console.log("Browser left open for 10 minutes for review; closing it never submits the claim.");
  await page.waitForTimeout(10 * 60 * 1000).catch(() => {});
}
await browser.close();
