import test from "node:test";
import assert from "node:assert/strict";
import { demoJourneys, detectClaims, parseCsv } from "../public/engine.js";

test("parses quoted TfL CSV and incomplete journeys", () => {
  const csv = 'Date,Time,Journey,Charge (GBP),Capped,Notes\n26/06/2026,08:15 - --:--,Bank to Unknown,-5.90,N,"As there is no record, it is incomplete."';
  const [journey] = parseCsv(csv);
  assert.equal(journey.charge, 5.9);
  assert.equal(journey.incomplete, true);
  assert.equal(journey.from, "Bank");
});

test("demo detects two delays and one maximum fare", () => {
  const now = new Date(2026, 8, 2, 12);
  const claims = detectClaims(demoJourneys(now), now);
  assert.deepEqual(claims.map(claim => claim.type).sort(), ["delay", "delay", "max-fare"]);
  assert.equal(claims.reduce((sum, claim) => sum + claim.amount, 0), 9);
});
