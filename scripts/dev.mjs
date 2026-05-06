// Dev server launcher med ren shutdown på Windows (unngår "Terminate batch job" prompt)
import { spawn } from "node:child_process";
import { get } from "node:https";

const isWin = process.platform === "win32";
const children = [];
let shuttingDown = false;

function spawnProc(name, cmd, args, opts = {}) {
  const proc = spawn(cmd, args, {
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  proc.procName = name;
  children.push(proc);
  proc.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[${name}] exited with code ${code}`);
      shutdown();
    }
  });
  return proc;
}

function killAll() {
  for (const child of children) {
    if (child.exitCode === null) {
      try {
        if (isWin) {
          // På Windows: bruk taskkill for å drepe hele prosesstreet
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            shell: false,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // prosessen kan allerede være død
      }
    }
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping dev servers...");
  killAll();
  // Gi prosessene litt tid til å dø, deretter force exit
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Finn pnpm
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

spawnProc("backend", pnpm, ["dev:backend"]);

function waitForHealth(url, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (shuttingDown) return reject(new Error("shutting down"));
      get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on("error", retry);
    };
    const retry = () => {
      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 1000);
      }
    };
    check();
  });
}

waitForHealth("http://localhost:4000/health", 60000)
  .then(() => {
    spawnProc("frontend", pnpm, ["dev:frontend"]);
    spawnProc("docs", pnpm, ["dev:docs"]);
  })
  .catch((err) => {
    if (!shuttingDown) {
      console.error(`Health check failed: ${err.message}`);
      shutdown();
    }
  });
