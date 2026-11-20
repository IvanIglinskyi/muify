import "./env.js"; // must stay first: loads server/.env before other modules read process.env
import { app } from "./app.js";
import { jamendoClientId } from "./jamendo/client.js";
import { clientDistDir, shouldServeClient } from "./static.js";

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST?.trim() || undefined;

const server = app.listen(PORT, HOST as string, () => {
  console.log(`MuiFy API: http://localhost:${PORT}`);
  if (shouldServeClient()) console.log(`[static] Serving the built client from ${clientDistDir()} (SPA fallback on).`);
  else if (process.env.NODE_ENV === "production") {
    console.warn(`[static] NODE_ENV=production but ${clientDistDir()} has no index.html — only the API is served. Run \`npm run build\` first.`);
  }
  // (The "not set" warning is logged once by the catalogue on first use.)
  if (jamendoClientId()) console.log("[jamendo] JAMENDO_CLIENT_ID found — serving real Creative Commons tracks from Jamendo.");
});

server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `[server] Port ${PORT} is already in use. Set PORT to another port.` : `[server] ${e.message}`);
  process.exit(1);
});
