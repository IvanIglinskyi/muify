// Lists leftover test accounts (muify-test-*@example.com) and the number of users/ nodes in RTDB.
// Run: cd server && npx tsx scripts/firebase-leftovers.ts
import "../src/env.js";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { firebase } from "../src/firebase.js";

const fb = await firebase();
const app = getApps().find((a) => a.name === "muify")!;
const { users } = await getAuth(app).listUsers(1000);
const tests = users.filter((u) => /^muify-test-.*@example\.com$/.test(u.email ?? ""));
const nodes = (await fb.db.get("users")) as Record<string, unknown> | null;
const shares = (await fb.db.get("sharedPlaylists")) as Record<string, unknown> | null;
console.log(
  `auth users total: ${users.length}, leftover test users: ${tests.length}, users/ nodes in RTDB: ${nodes ? Object.keys(nodes).length : 0}, ` +
    `sharedPlaylists entries: ${shares ? Object.keys(shares).length : 0}`
);
process.exit(0);
