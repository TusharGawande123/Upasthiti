// Local OWASP ZAP baseline scan of the Upasthiti stack (M6, extra S-58). Run from the repo root:
//   node scripts/zap-baseline.mjs
// It builds the website, starts the backend on the throw-away end-to-end database, puts the sample Caddy
// proxy (docs/guides/proxy-samples/Caddyfile) in front, and scans http://localhost:8080 with ZAP.
// It only ever scans this computer. The report goes to reports-local/ (git-ignored).
// Needs: Docker running, `docker compose up -d` (Postgres), uv and npm installed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_FOR_ZAP = "http://host.docker.internal:8080"; // the same proxy, seen from inside Docker
const PROXY_ORIGIN = "http://localhost:8080";
const ZAP_IMAGE = "ghcr.io/zaproxy/zaproxy:stable";
const CADDY_IMAGE = "caddy:2";
const REPORT_DIR = join(ROOT, "reports-local");
const PROXY_CONTAINER = "upasthiti-zap-proxy";

// Never scan anything but this computer.
const hostName = new URL(TARGET_FOR_ZAP.replace("host.docker.internal", "localhost")).hostname;
if (hostName !== "localhost") {
  throw new Error("Refused: the ZAP scan may only target this computer.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: command === "npm" && process.platform === "win32", ...options });
  return result.status ?? 1;
}

async function waitFor(url, seconds) {
  for (let second = 0; second < seconds; second += 2) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  throw new Error(`Not reachable in ${seconds} s: ${url}`);
}

// Same fake keys and throw-away database as the end-to-end tests; only the public origin is the proxy.
const { BACKEND_ENV } = await import(pathToFileURL(join(ROOT, "e2e", "backend-env.ts")).href);
const backendEnvironment = { ...process.env, ...BACKEND_ENV, APP_PUBLIC_ORIGIN: PROXY_ORIGIN, TRUSTED_PROXY_HOPS: "1" };
const backendFolder = join(ROOT, "backend");

let backend;
let exitCode = 1;
try {
  console.log("1/5 build the website");
  if (run("npm", ["run", "build"], { cwd: join(ROOT, "frontend") }) !== 0) throw new Error("build failed");

  console.log("2/5 wipe and fill the throw-away end-to-end database, start the backend");
  if (run("uv", ["run", "python", "-m", "app.scripts.e2e_seed"], { cwd: backendFolder, env: backendEnvironment }) !== 0) {
    throw new Error("seed failed");
  }
  backend = spawn("uv", ["run", "fastapi", "run", "app/main.py", "--port", "8000"], {
    cwd: backendFolder,
    env: backendEnvironment,
    stdio: "ignore",
    shell: false,
  });
  await waitFor("http://localhost:8000/api/v1/health", 90);

  console.log("3/5 start the sample Caddy proxy");
  run("docker", ["rm", "-f", PROXY_CONTAINER], { stdio: "ignore" });
  const started = run("docker", [
    "run", "-d", "--name", PROXY_CONTAINER, "-p", "8080:8080",
    "-e", "BACKEND_UPSTREAM=host.docker.internal:8000",
    "-v", `${join(ROOT, "docs", "guides", "proxy-samples", "Caddyfile")}:/etc/caddy/Caddyfile:ro`,
    "-v", `${join(ROOT, "frontend", "dist")}:/srv/upasthiti:ro`,
    CADDY_IMAGE,
  ]);
  if (started !== 0) throw new Error("proxy did not start");
  await waitFor(`${PROXY_ORIGIN}/api/v1/health`, 60);

  console.log("4/5 ZAP baseline scan (about 2 to 5 minutes)");
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  // -I: warnings do not fail the run; the lead reads the report. Exit 0 pass, 1 fail, 2 warnings.
  exitCode = run("docker", [
    "run", "--rm", "-v", `${REPORT_DIR}:/zap/wrk:rw`, "--add-host", "host.docker.internal:host-gateway",
    ZAP_IMAGE, "zap-baseline.py", "-t", TARGET_FOR_ZAP, "-r", "zap-report.html", "-J", "zap-report.json", "-I",
  ]);
  console.log(`ZAP finished with code ${exitCode}. Report: ${join(REPORT_DIR, "zap-report.html")}`);
} finally {
  console.log("5/5 clean up");
  run("docker", ["rm", "-f", PROXY_CONTAINER], { stdio: "ignore" });
  if (backend && backend.pid) {
    // On Windows the shell wrapper needs taskkill to end the whole backend tree.
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(backend.pid), "/t", "/f"], { stdio: "ignore" });
    else backend.kill();
  }
}
process.exit(exitCode);
