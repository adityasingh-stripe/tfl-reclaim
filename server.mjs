import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (relative.includes("..")) return response.writeHead(400).end("Bad request");
  try {
    const body = await readFile(join(root, relative));
    response.writeHead(200, { "content-type": `${types[extname(relative)] || "application/octet-stream"}; charset=utf-8` }).end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(process.env.PORT || 8787, "127.0.0.1", () => console.log("Reclaim → http://localhost:8787"));
