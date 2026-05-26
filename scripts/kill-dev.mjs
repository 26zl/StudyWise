// Skript for å drepe dev-server-prosesser på tvers av plattformer
// Dreper prosesser som lytter på vanlige dev-server-porter og fjerner Next.js lock-filen, cross-platform.
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import killPort from "kill-port";
import { exec } from "node:child_process";
import { promisify } from "node:util";

// Få repo-roten uansett hvor skriptet kjøres fra
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const ports = [3000, 4000, 5173];
const execAsync = promisify(exec);

// Dreper prosesser som lytter på de angitte portene
async function killPorts() {
  const isWin = process.platform === "win32";

  await Promise.all(
    ports.map(async (port) => {
      try {
        if (isWin) {
          // Windows: Bruk kill-port som før (siden bruker sa det funket der)
          await killPort(port, "tcp");
        } else {
          // macOS/Linux: Bruk lsof og kill -9 for mer robust håndtering
          try {
            // Finn PID(er) som lytter på porten
            const { stdout } = await execAsync(`lsof -i tcp:${port} -t`);
            const pids = stdout.trim().split("\n").filter(Boolean);

            if (pids.length > 0) {
              // Drep alle PIDs funnet
              await execAsync(`kill -9 ${pids.join(" ")}`);
              console.log(`✓ Killed port ${port} (PIDs: ${pids.join(", ")})`);
            } else {
              console.log(`· Port ${port} was not in use`);
            }
          } catch (e) {
            // lsof exit code 1 betyr ingen resultater funnet
            console.log(`· Port ${port} was not in use`);
          }
        }
      } catch (err) {
        const msg = err && typeof err === "object" && "message" in err ? err.message : String(err);
        if (msg.includes("is not listening") || msg.includes("No process running")) {
          console.log(`· Port ${port} was not in use`);
        } else {
          console.warn(`! Could not kill port ${port}: ${msg}`);
        }
      }
    }),
  );
}
// Fjerner Next.js dev lock-filen hvis den finnes
async function cleanNextLock() {
  const lockPath = path.join(repoRoot, "frontend", ".next", "dev", "lock");
  try {
    await rm(lockPath, { force: true });
    console.log("✓ Removed Next.js dev lock");
  } catch (err) {
    // Ignorer hvis filen allerede er borte
    const code = err?.code;
    if (code !== "ENOENT") {
      console.warn(`! Could not remove lock file: ${err}`);
    }
  }
}
// Hovedfunksjon
async function main() {
  await killPorts();
  await cleanNextLock();
  console.log("Done. Dev servers stopped.");
}
// Kjør hovedfunksjonen og håndter feil
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
