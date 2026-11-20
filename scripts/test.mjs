// Runs the server and client test suites (`npm test` in each package).
//
// Each package runs with its *canonical* path as the working directory: on Windows a shell whose
// cwd has a lower-case drive letter ("c:\projects\…") otherwise makes Vitest load two copies of
// itself and fail with "Vitest failed to find the runner".
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync.native(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const pkg of ["server", "client"]) {
  const cwd = realpathSync.native(path.join(root, pkg));
  console.log(`\n▶ ${pkg}: npm test`);
  const r = spawnSync(npm, ["test"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`✖ ${pkg} tests failed`);
    process.exit(r.status ?? 1);
  }
}
console.log("\n✔ all tests passed");
