import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { boundedStep, ConsentStepError } from "./consent-loading";

describe("login never spins on a stalled session check", () => {
  it("login beforeLoad bounds getSession and falls back to the form", () => {
    const s = readFileSync("src/routes/login.tsx", "utf8");
    expect(s).toMatch(/boundedStep\("session", \(\) => supabase\.auth\.getSession\(\), 6_000\)/);
    expect(s).not.toMatch(/const \{ data \} = await supabase\.auth\.getSession\(\);\n\s*if \(data\.session\)/);
  });
  it("a hung getSession times out instead of hanging", async () => {
    await expect(boundedStep("session", () => new Promise(() => {}), 20)).rejects.toBeInstanceOf(ConsentStepError);
  });
});
