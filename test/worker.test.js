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

test("Browserbase connection requires the prototype access code", async () => {
  const response = await handleRequest(
    new Request("https://reclaim.test/api/browserbase/connect", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    { BROWSERBASE_API_KEY: "key", BROWSERBASE_PROJECT_ID: "project", CONNECT_TOKEN: "invite", ASSETS: {} },
  );
  assert.equal(response.status, 401);
});

test("Browserbase connection creates a persistent context and live view", async () => {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body && JSON.parse(options.body) });
    if (String(url).endsWith("/contexts")) return Response.json({ id: "context-123" });
    if (String(url).endsWith("/sessions")) return Response.json({ id: "session-123", expiresAt: "soon" });
    return Response.json({ debuggerFullscreenUrl: "https://browserbase.test/live" });
  };
  const response = await handleRequest(
    new Request("https://reclaim.test/api/browserbase/connect", { method: "POST", headers: { "content-type": "application/json", "x-connect-token": "invite" }, body: "{}" }),
    { BROWSERBASE_API_KEY: "key", BROWSERBASE_PROJECT_ID: "project", CONNECT_TOKEN: "invite", ASSETS: {} },
    fetcher,
  );
  const result = await response.json();
  assert.equal(result.liveUrl, "https://browserbase.test/live");
  assert.deepEqual(calls[1].body.browserSettings.context, { id: "context-123", persist: true });
  assert.equal(calls[1].body.keepAlive, undefined);
  assert.equal(calls.every(call => !call.url.includes("key")), true);
});
