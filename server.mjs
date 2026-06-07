import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTdnetEarnings, saveEarningsData } from "./tools/fetch-tdnet-earnings.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname === "/api/earnings") {
      const date = url.searchParams.get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        sendJson(response, 400, { error: "date must be YYYY-MM-DD" });
        return;
      }

      const data = await fetchTdnetEarnings(date);
      await saveEarningsData(data, join(root, "data"), { writeLatest: false });
      sendJson(response, 200, data);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`daily-company-intel listening at http://${host}:${port}/`);
});

async function serveStatic(pathname, response) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(root, `.${normalize(decodeURIComponent(requestPath))}`);

  if (!filePath.startsWith(root)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    sendText(response, 404, "Not found");
    return;
  }

  const body = await readFile(filePath);
  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}
