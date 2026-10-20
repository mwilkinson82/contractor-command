import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SOV_DELIVERY_ASK, SOV_DELIVERY_ASK_CLIENT, SOV_DELIVERY_BLOCK, SOV_DELIVERY_BLOCK_CLIENT, SOV_DELIVERY_STRUCTURED, SOV_DELIVERY_STRUCTURED_CLIENT,
  sovDeliveryAsk, sovDeliveryBlock, sovDeliveryStructured, visibleProblems,
} from "./visible";
import { SOV_SPECS_MISSING_NOTE } from "./sov";
import { ATHENA_VERSION } from "./server-info-branding";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("0.8.6 SOV delivery follow-ups", () => {
  it("option 3 names Claude, ChatGPT and Grok Bot", () => {
    expect(SOV_DELIVERY_ASK).toContain("(a Claude artifact, ChatGPT canvas or Grok Bot)");
  });
  it("owner/client SOV drops option 3 entirely", () => {
    expect(SOV_DELIVERY_ASK_CLIENT).toContain("1. In your project software");
    expect(SOV_DELIVERY_ASK_CLIENT).toContain("2. As an Excel file (.xlsx).");
    expect(SOV_DELIVERY_ASK_CLIENT).not.toContain("3.");
    expect(SOV_DELIVERY_ASK_CLIENT).not.toMatch(/artifact|canvas|chat link|Grok Bot/i);
    expect(SOV_DELIVERY_STRUCTURED_CLIENT.options.map((o) => o.n)).toEqual([1, 2]);
    expect(SOV_DELIVERY_STRUCTURED_CLIENT.ask).toBe(SOV_DELIVERY_ASK_CLIENT);
    expect(SOV_DELIVERY_STRUCTURED_CLIENT.required_next_step).toBe(true);
    expect(SOV_DELIVERY_BLOCK_CLIENT).toContain(SOV_DELIVERY_ASK_CLIENT);
    expect(SOV_DELIVERY_BLOCK_CLIENT).not.toContain(SOV_DELIVERY_ASK);
  });
  it("team SOV keeps all three options", () => {
    expect(sovDeliveryAsk("internal")).toBe(SOV_DELIVERY_ASK);
    expect(sovDeliveryStructured("internal")).toBe(SOV_DELIVERY_STRUCTURED);
    expect(sovDeliveryBlock("internal")).toBe(SOV_DELIVERY_BLOCK);
    expect(sovDeliveryAsk("client")).toBe(SOV_DELIVERY_ASK_CLIENT);
  });
  it("no-specs note says spec sections will be cited once specs are uploaded", () => {
    expect(SOV_SPECS_MISSING_NOTE).toContain("Spec sections will be cited once specs are uploaded.");
    expect(visibleProblems(SOV_SPECS_MISSING_NOTE)).toEqual([]);
    expect(visibleProblems(SOV_DELIVERY_ASK_CLIENT)).toEqual([]);
  });
  it("report sov is wired by audience and prints the specs note", () => {
    const w = src("./tools/workflow-tools.ts");
    expect(w).toContain("delivery: sovDeliveryStructured(audience)");
    expect(w).toContain("sovDeliveryBlock(audience),");
    expect(w).toContain("${sovSpecsMissing(sov) ? `\\n${SOV_SPECS_MISSING_NOTE}` : \"\"}");
  });
  it("version is 0.8.6", () => expect(ATHENA_VERSION).toBe("0.8.8"));
});
