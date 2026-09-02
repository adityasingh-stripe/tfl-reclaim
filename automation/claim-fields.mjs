export const fieldValues = claim => ({
  journeyDate: claim?.journey?.date,
  journeyTime: claim?.journey?.time,
  origin: claim?.journey?.from,
  destination: claim?.journey?.to === "Unknown" ? claim?.suggestedDestination : claim?.journey?.to,
  reason: claim?.type === "delay"
    ? `Service delay: ${claim.actual} minutes actual against a ${claim.baseline} minute baseline (${claim.delta} minutes late).`
    : "Incomplete journey / maximum fare correction.",
});

export function validateConfiguration(configuration) {
  if (!configuration?.startUrl?.startsWith("https://tfl.gov.uk/")) {
    throw new Error("startUrl must be an official https://tfl.gov.uk/ URL");
  }
  if (!configuration.fields || typeof configuration.fields !== "object") {
    throw new Error("configuration.fields is required");
  }
}

export async function fillConfiguredFields(page, configuration, claim) {
  const values = fieldValues(claim);
  const filled = [];
  const missing = [];
  for (const [name, selector] of Object.entries(configuration.fields)) {
    if (!selector || values[name] == null) continue;
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(String(values[name]));
      filled.push(name);
    } else {
      missing.push(name);
    }
  }
  return { filled, missing };
}
