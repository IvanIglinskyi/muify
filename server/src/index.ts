import "./env.js"; // must stay first: loads server/.env before other modules read process.env
import { app } from "./app.js";
import { jamendoClientId } from "./jamendo/client.js";

const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, () => {
  console.log(`MuiFy API: http://localhost:${PORT}`);
  // (The "not set" warning is logged once by the catalogue on first use.)
  if (jamendoClientId()) console.log("[jamendo] JAMENDO_CLIENT_ID found — serving real Creative Commons tracks from Jamendo.");
});
