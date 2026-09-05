const ALLOWED_PATHS = ["/StopPoint/Search/", "/Journey/JourneyResults/", "/Line/"];

export async function handleRequest(request, env, fetcher = fetch, navigate = navigateBrowserbaseSession) {
  const incoming = new URL(request.url);
  if (incoming.pathname === "/api/browserbase/connect") return connectTfl(request, env, fetcher, navigate);
  if (!incoming.pathname.startsWith("/api/tfl/")) return env.ASSETS.fetch(request);
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const tflPath = `/${incoming.pathname.slice("/api/tfl/".length)}`;
  if (!ALLOWED_PATHS.some(prefix => tflPath.startsWith(prefix))) return new Response("TfL endpoint not allowed", { status: 404 });

  const target = new URL(`https://api.tfl.gov.uk${tflPath}`);
  incoming.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  if (env.TFL_API_KEY) target.searchParams.set("app_key", env.TFL_API_KEY);
  const response = await fetcher(target, { headers: { accept: "application/json" } });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": response.headers.get("cache-control") || "public, max-age=60",
    },
  });
}

async function connectTfl(request, env, fetcher, navigate) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const missing = ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "CONNECT_TOKEN"].filter(name => !env[name]);
  if (missing.length) {
    return json({ error: `Missing runtime bindings: ${missing.join(", ")}` }, 503);
  }
  if (request.headers.get("x-connect-token") !== env.CONNECT_TOKEN) return json({ error: "Invalid access code" }, 401);

  try {
    const body = await request.json();
    let contextId = typeof body.contextId === "string" && /^[\w-]{8,100}$/.test(body.contextId) ? body.contextId : undefined;
    if (!contextId) {
      const context = await browserbase("/contexts", env, fetcher, { projectId: env.BROWSERBASE_PROJECT_ID });
      contextId = context.id;
    }
    const session = await browserbase("/sessions", env, fetcher, {
      projectId: env.BROWSERBASE_PROJECT_ID,
      timeout: 900,
      browserSettings: { context: { id: contextId, persist: true } },
    });
    await navigate(session.connectUrl, "https://tfl.gov.uk/account");
    const debug = await browserbase(`/sessions/${encodeURIComponent(session.id)}/debug`, env, fetcher);
    return json({
      contextId,
      sessionId: session.id,
      liveUrl: debug.debuggerFullscreenUrl || debug.debuggerUrl,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Browserbase connect failed", error);
    return json({ error: `Could not start the secure TfL browser (${error.message})` }, 502);
  }
}

export function navigateBrowserbaseSession(connectUrl, url, WebSocketClient = WebSocket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketClient(connectUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("TfL navigation timed out")); }, 10000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url } })));
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      message.error ? reject(new Error("TfL navigation failed")) : resolve(message.result);
    });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not connect to the secure browser")); });
  });
}

async function browserbase(path, env, fetcher, body) {
  const response = await fetcher(`https://api.browserbase.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-bb-api-key": env.BROWSERBASE_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
