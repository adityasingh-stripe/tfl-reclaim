import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../worker.js";

test("TfL proxy injects the secret without exposing it to the client", async () => {
  let target;
  const fetcher = async url => { target = url; return new Response("{}", { headers: { "content-type": "application/json" } }); };
  const response = await handleRequest(
    new Request("https://reclaim.test/api/tfl/StopPoint/Search/Bank?modes=tube"),
    { TFL_API_KEY: "private-key", ASSETS: {} },
    fetcher,
  );
  assert.equal(response.status, 200);
  assert.equal(target.hostname, "api.tfl.gov.uk");
  assert.equal(target.searchParams.get("app_key"), "private-key");
});

test("TfL proxy rejects arbitrary upstream paths", async () => {
  const response = await handleRequest(new Request("https://reclaim.test/api/tfl/Road"), { ASSETS: {} });
  assert.equal(response.status, 404);
});
