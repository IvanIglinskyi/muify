// Loads server/.env (if present) into process.env using Node's built-in loader — no dotenv.
// Imported first by index.ts so every other module sees the variables.
// The path is resolved from this file, so it works from both src/ (tsx) and dist/ (node).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    console.warn(`[env] Could not read ${envPath}: ${(e as Error).message}`);
  }
}
