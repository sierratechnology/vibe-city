import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkRecordsApiHandler } from "./workRecordsApi.mjs";
import { WorkRecordStore } from "./workRecords.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function safePort(value) {
  const port = Number(value ?? 4173);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("VIBE_WORK_RECORD_PORT must be a valid local port");
  return port;
}

function serveFile(response, path) {
  response.writeHead(200, {
    "cache-control": path.endsWith(".html") ? "no-cache" : "public, max-age=3600",
    "content-type": MIME_TYPES.get(extname(path)) ?? "application/octet-stream",
    "x-content-type-options": "nosniff"
  });
  createReadStream(path).pipe(response);
}

function createProductionHandler() {
  const distribution = join(ROOT, "dist");
  const indexPath = join(distribution, "index.html");
  if (!existsSync(indexPath)) throw new Error("Production bundle missing; run npm run build first");
  return (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const requested = resolve(distribution, pathname.replace(/^\/+/, ""));
    const insideDistribution = requested === distribution || !relative(distribution, requested).startsWith(`..${sep}`) && relative(distribution, requested) !== "..";
    if (insideDistribution && existsSync(requested) && statSync(requested).isFile()) serveFile(response, requested);
    else serveFile(response, indexPath);
  };
}

export async function startWorkRecordsServer({
  development = false,
  host = process.env.VIBE_WORK_RECORD_HOST ?? "127.0.0.1",
  port = safePort(process.env.VIBE_WORK_RECORD_PORT),
  databasePath = process.env.VIBE_WORK_RECORD_DB ?? join(ROOT, ".runtime", "work-records.sqlite"),
  token = process.env.VIBE_WORK_RECORD_TOKEN
} = {}) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Work-record prototype only permits loopback binding");
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const store = new WorkRecordStore(databasePath);
  const api = createWorkRecordsApiHandler({ store, expectedToken: token });
  let applicationHandler;
  let vite;
  if (development) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({ root: ROOT, appType: "spa", server: { middlewareMode: true } });
    applicationHandler = (request, response) => new Promise((resolveRequest) => {
      vite.middlewares(request, response, () => {
        if (!response.headersSent) response.writeHead(404).end();
        resolveRequest();
      });
    });
  } else {
    applicationHandler = createProductionHandler();
  }
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/work-events") await api(request, response);
    else await applicationHandler(request, response);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`Vibe City local work-record prototype listening on http://${host}:${boundPort}`);
  if (!token) console.log("Authenticated ingestion is disabled until VIBE_WORK_RECORD_TOKEN is set.");
  return {
    host,
    port: boundPort,
    close: async () => {
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      if (vite) await vite.close();
      store.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const development = process.argv.includes("--dev");
  startWorkRecordsServer({ development }).catch(() => {
    console.error("Failed to start the local Vibe City work-record prototype.");
    process.exitCode = 1;
  });
}
