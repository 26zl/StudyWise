// Cross-platform dev server killer script
// Dreper prosesser som lytter på vanlige dev-server-porter og fjerner Next.js lock-filen, cross-platform.
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import killPort from "kill-port";

// Få repo-roten uansett hvor skriptet kjøres fra
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const ports = [3000, 4000, 5173];

// Dreper prosesser som lytter på de angitte portene
async function killPorts() {
  await Promise.all(
    ports.map(async (port) => {
      try {
        await killPort(port, "tcp");
        console.log(`✓ Killed port ${port}`);
      } catch (err) {
        // kill-port kaster hvis ingenting lytter; ignorer i så fall
        const msg = (err && typeof err === "object" && "message" in err) ? err.message : String(err);
        if (msg.includes("is not listening")) {
          console.log(`· Port ${port} was not in use`);
        } else {
          console.warn(`! Could not kill port ${port}: ${msg}`);
        }
      }
    })
  );
}
// Fjerner Next.js dev lock-filen hvis den finnes
async function cleanNextLock() {
  const lockPath = path.join(repoRoot, "frontend", ".next", "dev", "lock");
  try {
    await rm(lockPath, { force: true });
    console.log("✓ Removed Next.js dev lock");
  } catch (err) {
    // Ignore if file already gone
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
