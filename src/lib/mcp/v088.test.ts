import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATHENA_SERVER_ICONS, ATHENA_VERSION } from "./server-info-branding";
import { emailContact, EMAIL_CONTACT_RULE } from "./contacts";
import { sovChart, sovRequiredTop, splitGuidance, visibleProblems } from "./visible";
import { siteIconResponse } from "../site-icons";
import { athenaIcon64Bytes } from "./athena-icon-64";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const jordan = { name: "Jordan Reyes", role: "Project Manager", company: "Calloway Builders", email: null as string | null, source: "test" };

describe("0.8.8 blue brand, To field, pinned REQUIRED lines, sweep cards", () => {
  it("version is 0.8.8 or later (0.8.9)", () => expect(ATHENA_VERSION).toBe("0.8.13"));
  it("connector icons are the mono-blue mark at new URLs", () => {
    expect(ATHENA_SERVER_ICONS.map((i) => i.src).filter((s) => !s.startsWith("data:"))).toEqual([
      "https://app.meetathena.io/brand/athena/athena-mono-blue-64.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-128.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-256.png",
    ]);
    const b = Buffer.from(athenaIcon64Bytes());
    expect(b.readUInt32BE(16)).toBe(64);
  });
  it("blue icon PNGs serve on both domains with open CORS; Circle favicon untouched", async () => {
    for (const host of ["app.meetathena.io", "app.alpcontractorcircle.com"]) {
      const r = siteIconResponse(new Request(`https://${host}/brand/athena/athena-mono-blue-512.png`))!;
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      const b = Buffer.from(await r.arrayBuffer());
      expect(b.readUInt32BE(16)).toBe(512);
    }
    const circle = siteIconResponse(new Request("https://app.alpcontractorcircle.com/favicon.svg"))!;
    expect(circle.headers.get("access-control-allow-origin")).toBeNull();
    expect(await circle.text()).toContain("#F5F1E8");
    const athena = await siteIconResponse(new Request("https://app.meetathena.io/favicon.svg"))!.text();
    expect(athena).toContain("mono-blue");
    const mf = JSON.parse(await siteIconResponse(new Request("https://app.meetathena.io/site.webmanifest"))!.text());
    expect(mf.theme_color).toBe("#2563EB");
  });
  it("sign-in shell and email use the blue mark and no orange", () => {
    const card = src("../../components/auth/auth-card.tsx");
    expect(src("../login-copy.ts")).toContain("/brand/athena/athena-lockup-blue.svg");
    expect(card).toContain("ATHENA_LOGIN_LOGO");
    expect(card).not.toContain("#B9512C");
    const mail = src("../email-templates/athena-magic-link.tsx");
    expect(mail).toContain("athena-mono-blue-512.png");
    expect(mail).toContain("#2563EB");
  });
  it("email contact: To line first and a To field, filled or asked", () => {
    const none = emailContact(jordan);
    expect(none.text.split("\n")[0]).toBe("To: (ask: what's Jordan Reyes's email?)");
    expect(none.structured.to_field).toEqual({ show: true, label: "To", value: "", blank: true });
    expect(none.structured.ask_in_same_reply).toBe(true);
    const known = emailContact({ ...jordan, email: "jordan.reyes@example.com" });
    expect(known.text.split("\n")[0]).toBe("To: jordan.reyes@example.com");
    expect(known.structured.to_field.value).toBe("jordan.reyes@example.com");
    expect(emailContact(null).structured.to_field.show).toBe(true);
    expect(visibleProblems(none.text)).toEqual([]);
    expect(EMAIL_CONTACT_RULE).toContain("Claude included");
  });
  it("report sov pins REQUIRED lines at the top of the visible text", () => {
    const top = sovRequiredTop([{ item_no: "26.01", cost_code: "26-010", scheduled_value_display: "$100,000.00" }], "To: (ask: what's Jordan Reyes's email?)");
    const lines = top.split("\n");
    expect(lines[0]).toMatch(/^REQUIRED: Draw this bar chart now under the table/);
    expect(lines[0]).toContain("26.01 (26-010) $100,000.00");
    expect(lines[0]).toContain("#2563EB");
    expect(lines[0]).toContain("gray bands");
    // 0.8.10: a 4th pinned line, the email attachment rule.
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 2).join("\n")).not.toMatch(/owner|no exceptions/i);
    expect(lines[2]).toMatch(/^REQUIRED: .*all 3 sharing options/);
    expect(lines[1]).toContain("To: (ask:");
    expect(splitGuidance(top + "\nShow the email card now.").visible.startsWith(top)).toBe(true);
    expect(src("./tools/workflow-tools.ts")).toContain("...text(`${sovRequiredTop(");
  });
  it("chart carries gray as well as blue", () => {
    const c = sovChart([{ item_no: "1", cost_code: null, description: "x", scheduled_value: 1, scheduled_value_display: "$1.00" }]);
    expect(c.bar_color).toBe("#2563EB");
    expect(c.band_colors).toContain("#F3F4F6");
    expect(c.grid_color).toBe("#D1D5DB");
  });
  it("date sweep renders as a short card list", () => {
    const s = src("./sweep.ts");
    expect(s).toContain("**Date sweep**");
    expect(s).not.toContain("DATE SWEEP");
  });
});
