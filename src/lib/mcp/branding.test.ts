import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FOOTER } from "./guard";

const FULL = "Athena powered by ALP, construction agents";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Athena powered by ALP, construction agents branding", () => {
  it("every tool reply footer carries the full words", () => {
    expect(FOOTER).toContain(FULL);
    expect(FOOTER).not.toMatch(/private prototype|Contractor Circle/i);
  });
  it("the Athena sign-in / consent card footer carries the full words", () => {
    expect(read("../../components/auth/auth-card.tsx")).toContain(`footer ?? "${FULL}"`);
  });
  it("consent page names Athena, not the Hub", () => {
    const c = read("../../routes/oauth.consent.tsx");
    expect(c).toContain("Connect ${clientName} to Athena`");
    expect(c).not.toMatch(/PM agent|Contractor Circle/);
  });
  it("agent default and tool text say Athena", () => {
    expect(read("./jobs.ts")).toContain('agent_name ?? "Athena"');
    expect(read("./tools/workflow-tools.ts")).toContain("Default 'Athena'.");
    expect(read("./index.ts")).not.toMatch(/private prototype|PM agent|contractor-circle-hub/);
  });
});
