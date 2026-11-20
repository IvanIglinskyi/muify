// `npm start` at the repo root: runs the production build (API + built client) on one port.
// Build first with `npm run build`. PORT (default 4000), see README → Deploy for the other variables.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV ||= "production";

const entry = new URL("../server/dist/index.js", import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  console.error("server/dist/index.js is missing — run `npm run build` first.");
  process.exit(1);
}
await import(entry.href);
