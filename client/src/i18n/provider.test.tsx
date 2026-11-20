import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatHoursMinutes, formatLongDuration } from "../lib/format";
import { getLang } from "./core";
import { I18nProvider, Trans, useI18n, useT } from "./index";

function Probe() {
  const t = useT();
  const { setLang } = useI18n();
  return (
    <div>
      <h1>{t("aotd.title")}</h1>
      <p data-testid="plural">{t("common.tracksMeta", { count: 3 })}</p>
      <p data-testid="duration">{formatLongDuration(3 * 3600 + 57 * 60)}</p>
      <p data-testid="trans">
        <Trans k="verify.text" values={{ email: <strong>a@b.c</strong> }} />
      </p>
      <button onClick={() => setLang("en")}>en</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("I18nProvider", () => {
  it("renders Ukrainian, sets <html lang> and formats durations in the language", () => {
    render(
      <I18nProvider initial="uk">
        <Probe />
      </I18nProvider>
    );
    expect(document.documentElement.lang).toBe("uk");
    expect(screen.getByRole("heading").textContent).toBe("Альбом дня");
    expect(screen.getByTestId("plural").textContent).toBe("3 треки");
    expect(screen.getByTestId("duration").textContent).toBe("3 год 57 хв");
    expect(screen.getByTestId("trans").innerHTML).toBe("Підтвердьте адресу <strong>a@b.c</strong> — ми надіслали вам посилання.");
  });

  it("switches language at runtime and remembers it", () => {
    render(
      <I18nProvider initial="uk">
        <Probe />
      </I18nProvider>
    );
    act(() => screen.getByRole("button").click());
    expect(screen.getByRole("heading").textContent).toBe("Album of the day");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("muify:lang")).toBe("en");
    expect(getLang()).toBe("en");
    expect(formatHoursMinutes(12000)).toBe("3 h 20 min");
  });
});
