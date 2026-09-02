import assert from "node:assert/strict";
import test from "node:test";
import { fieldValues, validateConfiguration } from "../automation/claim-fields.mjs";

test("maps a delay claim to reviewable TfL fields", () => {
  assert.deepEqual(fieldValues({
    type: "delay", journey: { date: "01/09/2026", time: "08:14", from: "Brixton", to: "Oxford Circus" },
    actual: 34, baseline: 11, delta: 23,
  }), {
    journeyDate: "01/09/2026", journeyTime: "08:14", origin: "Brixton", destination: "Oxford Circus",
    reason: "Service delay: 34 minutes actual against a 11 minute baseline (23 minutes late).",
  });
});

test("uses the confirmed destination for an incomplete journey", () => {
  assert.equal(fieldValues({ type: "maximum_fare", journey: { to: "Unknown" }, suggestedDestination: "Bethnal Green" }).destination, "Bethnal Green");
});

test("only permits official TfL start URLs", () => {
  assert.throws(() => validateConfiguration({ startUrl: "https://example.com", fields: {} }), /official/);
  assert.doesNotThrow(() => validateConfiguration({ startUrl: "https://tfl.gov.uk/fares/refunds/", fields: {} }));
});
