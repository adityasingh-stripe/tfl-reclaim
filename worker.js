const ALLOWED_PATHS = ["/StopPoint/Search/", "/Journey/JourneyResults/", "/Line/"];

export async function handleRequest(request, env, fetcher = fetch) {
  const incoming = new URL(request.url);
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

export default { fetch: handleRequest };
