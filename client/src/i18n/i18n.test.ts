import { describe, expect, it } from "vitest";
import { browserLang, interpolate, selectPlural, translate, type PluralForms } from "./core";
import { en } from "./en";
import { uk } from "./uk";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (m: unknown): string[] => (typeof m === "string" ? [m] : Object.values(m as PluralForms));

describe("dictionaries", () => {
  it("uk and en have exactly the same keys", () => {
    const enKeys = Object.keys(en).sort();
    const ukKeys = Object.keys(uk).sort();
    expect(ukKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !ukKeys.includes(k))).toEqual([]);
  });

  it("plural messages stay plural and Ukrainian ones have one/few/many/other", () => {
    for (const [key, msg] of Object.entries(en)) {
      const u = (uk as Record<string, unknown>)[key];
      expect(typeof u === "string", key).toBe(typeof msg === "string");
      if (typeof msg !== "string") {
        expect(Object.keys(u as object).sort(), key).toEqual(["few", "many", "one", "other"]);
      }
    }
  });

  it("every translation uses the same placeholders as English", () => {
    for (const [key, msg] of Object.entries(en)) {
      const want = placeholders(forms(msg).join(" ")).filter((p, i, a) => a.indexOf(p) === i);
      const u = (uk as Record<string, unknown>)[key];
      for (const f of forms(u)) {
        // A form may omit {count} only if English does too.
        const got = placeholders(f).filter((p, i, a) => a.indexOf(p) === i);
        expect(got.every((p) => want.includes(p)), `${key}: ${f}`).toBe(true);
      }
      expect(placeholders(forms(u).join(" ")).filter((p, i, a) => a.indexOf(p) === i), key).toEqual(want);
    }
  });

  it("has no empty messages (except deliberate ones)", () => {
    const allowedEmpty = new Set(["table.timeSuffix"]);
    for (const [key, msg] of Object.entries(uk)) {
      for (const f of forms(msg)) if (!allowedEmpty.has(key)) expect(f.trim(), key).not.toBe("");
    }
  });
});

describe("translate", () => {
  it("interpolates and formats numbers per locale", () => {
    expect(translate("en", "common.artistYear", { artist: "Ann", year: "2024" })).toBe("Ann - 2024");
    expect(interpolate("en", "{n} items", { n: 2523 })).toBe("2,523 items");
    expect(interpolate("uk", "{n}", { n: 2523 }).replace(/\s/g, " ")).toBe("2 523");
    expect(interpolate("en", "{missing}", {})).toBe("{missing}");
  });

  it("uses English plural rules", () => {
    expect(translate("en", "common.tracksCount", { count: 1 })).toBe("1 track");
    expect(translate("en", "common.tracksCount", { count: 2 })).toBe("2 tracks");
    expect(translate("en", "common.tracksCount", { count: 0 })).toBe("0 tracks");
  });

  it("uses Ukrainian plural rules (one / few / many)", () => {
    const n = (count: number) => translate("uk", "common.tracksCount", { count });
    expect(n(1)).toBe("1 трек");
    expect(n(21)).toBe("21 трек");
    expect(n(2)).toBe("2 треки");
    expect(n(4)).toBe("4 треки");
    expect(n(22)).toBe("22 треки");
    expect(n(5)).toBe("5 треків");
    expect(n(11)).toBe("11 треків");
    expect(n(14)).toBe("14 треків");
    expect(n(0)).toBe("0 треків");
    expect(n(1.5)).toBe("1,5 трека");
    expect(selectPlural("uk", { one: "a", few: "b", many: "c", other: "d" }, 112)).toBe("c");
  });
});

describe("browserLang", () => {
  it("picks Ukrainian only for uk", () => {
    expect(browserLang(["uk-UA", "en"])).toBe("uk");
    expect(browserLang(["uk"])).toBe("uk");
    expect(browserLang(["en-US", "uk"])).toBe("en");
    expect(browserLang(["ru-RU"])).toBe("en");
    expect(browserLang([])).toBe("en");
  });
});
