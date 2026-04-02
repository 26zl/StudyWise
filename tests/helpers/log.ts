/** Shared logging utilities for test scripts. */
export function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

export function header(msg: string) {
  log(`\n${"=".repeat(60)}`);
  log(`  ${msg}`);
  log("=".repeat(60));
}
