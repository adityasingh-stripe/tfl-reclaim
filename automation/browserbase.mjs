const apiRoot = "https://api.browserbase.com/v1";

const headers = apiKey => ({
  "content-type": "application/json",
  "x-bb-api-key": apiKey,
});

async function browserbaseRequest(path, apiKey, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, { ...options, headers: { ...headers(apiKey), ...options.headers } });
  if (!response.ok) throw new Error(`Browserbase API ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function createBrowserbaseSession({ apiKey, projectId }) {
  if (!apiKey || !projectId) throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required");
  return browserbaseRequest("/sessions", apiKey, {
    method: "POST",
    body: JSON.stringify({ projectId, keepAlive: true }),
  });
}

export async function getBrowserbaseDebug(sessionId, apiKey) {
  try {
    return await browserbaseRequest(`/sessions/${encodeURIComponent(sessionId)}/debug`, apiKey);
  } catch (error) {
    console.warn(`Browserbase debug URL unavailable: ${error.message}`);
    return {};
  }
}

export function sessionLinks(session, debug = {}) {
  return {
    debuggerUrl: debug.debuggerFullscreenUrl || debug.debuggerUrl,
    replayUrl: debug.sessionReplayUrl || session.sessionReplayUrl,
  };
}
