import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ATHENA_ACCENTS } from "./auth-card";

const ORANGE = /#(d97757|c36e4f|e0967b|b8442a)|217 119 87|orange/i;
const tokens = ATHENA_ACCENTS as Record<string, string>;

describe("Athena sign-in shell colors", () => {
  it("re-points the raw tokens the @theme inline utilities read (not the --color-* aliases)", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/@theme inline/);
    for (const raw of [
      "--signal",
      "--clay",
      "--ring",
      "--ink",
      "--primary",
      "--primary-foreground",
    ]) {
      expect(tokens[raw], raw).toBeTruthy();
    }
    expect(Object.keys(tokens).some((k) => k.startsWith("--color-"))).toBe(false);
  });
  it("button is Athena blue with white text, field focus is blue, no orange anywhere", () => {
    expect(tokens["--signal"]).toBe("#2563EB");
    expect(tokens["--ink"]).toBe("#FFFFFF");
    expect(tokens["--clay"]).toBe("#1D4ED8");
    expect(tokens["--ring"]).toMatch(/37 99 235/);
    for (const v of Object.values(tokens)) expect(v).not.toMatch(ORANGE);
  });
  it("hub keeps its orange tokens in styles.css", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/--signal: #d97757/);
    expect(css).toMatch(/--clay: #c36e4f/);
  });
  it("only the athena branch of AuthCard applies the overrides, with a darker hover", () => {
    const s = readFileSync("src/components/auth/auth-card.tsx", "utf8");
    expect(s).toMatch(/data-brand="athena"[\s\S]*style=\{\{ \.\.\.ATHENA_ACCENTS/);
    expect(s.match(/ATHENA_ACCENTS/g)?.length).toBe(2);
    expect(s).toMatch(/\[&_\.bg-signal:hover\]:bg-\[#1D4ED8\]/);
  });
});

describe("Athena sign-in help link", () => {
  it("mails Athena support, while the Circle hub keeps the Circle inbox", async () => {
    const { ATHENA_SUPPORT_MAILTO } = await import("@/lib/login-copy");
    expect(ATHENA_SUPPORT_MAILTO).toBe(
      "mailto:support@meetathena.io?subject=Help%20signing%20in%20to%20Athena",
    );
    const s = readFileSync("src/components/auth/auth-card.tsx", "utf8");
    expect(s).toMatch(/href=\{ATHENA_SUPPORT_MAILTO\}[\s\S]{0,200}Need help signing in\?/);
    expect(s.match(/support@alpcontractorcircle\.com/g)).toHaveLength(1);
  });
});
