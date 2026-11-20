// Production static serving of the built client (SPA fallback, cache headers) + trust proxy parsing.
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { trustProxySetting } from "../src/security.js";
import { clientRouter, shouldServeClient } from "../src/static.js";

const dir = mkdtempSync(path.join(tmpdir(), "muify-dist-"));
mkdirSync(path.join(dir, "assets"));
writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>MuiFy</title>");
writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
writeFileSync(path.join(dir, "sw.js"), "self.addEventListener('fetch',()=>{})");
writeFileSync(path.join(dir, "manifest.webmanifest"), "{}");
writeFileSync(path.join(dir, "icon-192.png"), "png");

const app = express();
app.get("/api/status", (_req, res) => res.json({ ok: true }));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(clientRouter(dir));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("clientRouter", () => {
  it("serves index.html for client routes (no-cache)", async () => {
    for (const p of ["/", "/explore", "/album/ja123", "/p/AbCdEf123456", "/search?q=rain"]) {
      const r = await request(app).get(p);
      expect(r.status, p).toBe(200);
      expect(r.text).toContain("<title>MuiFy</title>");
      expect(r.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("caches hashed assets for a year and 404s missing ones", async () => {
    const r = await request(app).get("/assets/index-abc123.js");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await request(app).get("/assets/index-old999.js")).status).toBe(404);
    expect((await request(app).get("/missing.png")).status).toBe(404);
  });

  it("revalidates the service worker and manifest", async () => {
    const sw = await request(app).get("/sw.js");
    expect(sw.headers["cache-control"]).toBe("no-cache");
    expect(sw.headers["service-worker-allowed"]).toBe("/");
    expect((await request(app).get("/manifest.webmanifest")).headers["cache-control"]).toBe("no-cache");
    expect((await request(app).get("/icon-192.png")).headers["cache-control"]).toBe("public, max-age=86400");
  });

  it("leaves the API alone", async () => {
    expect((await request(app).get("/api/status")).body).toEqual({ ok: true });
    const r = await request(app).get("/api/nope");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "Not found" });
  });

  it("is only enabled in production with a build present", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(shouldServeClient(dir)).toBe(true);
      expect(shouldServeClient(path.join(dir, "nope"))).toBe(false);
      process.env.NODE_ENV = "development";
      expect(shouldServeClient(dir)).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe("trustProxySetting", () => {
  it("parses TRUST_PROXY", () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting("")).toBe(false);
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("true")).toBe(true);
    expect(trustProxySetting("1")).toBe(1);
    expect(trustProxySetting("loopback, 10.0.0.0/8")).toBe("loopback, 10.0.0.0/8");
  });
});
