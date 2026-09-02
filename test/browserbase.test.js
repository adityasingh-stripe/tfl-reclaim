import assert from "node:assert/strict";
import test from "node:test";
import { sessionLinks } from "../automation/browserbase.mjs";

test("reports Browserbase debugger and replay links returned by the API", () => {
  assert.deepEqual(sessionLinks(
    { sessionReplayUrl: "https://replay.example/session" },
    { debuggerFullscreenUrl: "https://debug.example/session" },
  ), {
    debuggerUrl: "https://debug.example/session",
    replayUrl: "https://replay.example/session",
  });
});

test("does not manufacture unavailable Browserbase links", () => {
  assert.deepEqual(sessionLinks({}, {}), { debuggerUrl: undefined, replayUrl: undefined });
});
