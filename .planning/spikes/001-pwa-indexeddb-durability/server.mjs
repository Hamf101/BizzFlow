import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROUTES = new Map([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

/**
 * Parse and validate the optional PORT environment value.
 *
 * @returns {number} A valid TCP port.
 * @throws {Error} When PORT is not an integer in the usable range.
 */
function resolvePort() {
  const rawPort = process.env.PORT;
  if (rawPort === undefined || rawPort === "") {
    return DEFAULT_PORT;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${rawPort}.`);
  }

  return parsedPort;
}

/**
 * Return a small response without exposing filesystem details.
 *
 * @param {import("node:http").ServerResponse} response HTTP response object.
 * @param {number} statusCode HTTP status code.
 * @param {string} message Plain-text response body.
 * @returns {void}
 */
function sendPlainText(response, statusCode, message) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(message),
  });
  response.end(message);
}

/**
 * Serve one allowlisted prototype asset.
 *
 * @param {import("node:http").IncomingMessage} request HTTP request object.
 * @param {import("node:http").ServerResponse} response HTTP response object.
 * @returns {Promise<void>} Resolves after the response is sent.
 */
async function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendPlainText(response, 405, "Method not allowed.\n");
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
  } catch (error) {
    console.warn("Rejected malformed prototype request URL.", {
      method: request.method,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    sendPlainText(response, 400, "Bad request.\n");
    return;
  }

  const route = ROUTES.get(pathname);
  if (route === undefined) {
    sendPlainText(response, 404, "Not found.\n");
    return;
  }

  const startedAt = performance.now();
  try {
    const body = await readFile(join(MODULE_DIRECTORY, route.fileName));
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": route.contentType,
      "Content-Length": body.byteLength,
    });
    response.end(request.method === "HEAD" ? undefined : body);
    console.info("Served prototype asset.", {
      method: request.method,
      pathname,
      statusCode: 200,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  } catch (error) {
    console.error("Failed to serve prototype asset.", {
      method: request.method,
      pathname,
      fileName: route.fileName,
      errorName: error instanceof Error ? error.name : "UnknownError",
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
    sendPlainText(response, 500, "Unable to load the prototype asset.\n");
  }
}

const port = resolvePort();
const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("clientError", (error, socket) => {
  console.warn("Prototype server rejected a client connection.", {
    errorName: error.name,
    errorCode: error.code,
  });
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.on("error", (error) => {
  console.error("Prototype server failed.", {
    host: HOST,
    port,
    errorName: error.name,
    errorCode: error.code,
  });
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.info(`BizFlow IndexedDB durability spike: http://${HOST}:${port}`);
  console.info("Synthetic fixtures only. Stop with Ctrl+C.");
});
