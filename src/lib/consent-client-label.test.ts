import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consentClientLabel, consentConnectTitle } from "./consent-client-label";

describe("consent client label", () => {
  it("names ChatGPT, Claude, and Grok Bot, and uses your AI otherwise", () => {
    expect(consentClientLabel({ name: "ChatGPT" })).toBe("ChatGPT");
    expect(consentClientLabel({ name: "ChatGPT Desktop", redirectUri: "https://chat.openai.com/callback" })).toBe("ChatGPT");
    expect(consentClientLabel({ name: "Claude" })).toBe("Claude");
    expect(consentClientLabel({ name: "Claude Desktop", redirectUri: "https://claude.ai/oauth" })).toBe("Claude");
    expect(consentClientLabel({ name: "Grok Bot" })).toBe("Grok Bot");
    expect(consentClientLabel({ name: "Some Vendor", redirectUri: "https://example.com/cb" })).toBe("your AI");
    expect(consentClientLabel({})).toBe("your AI");
  });

  it("treats cursor.com and grok redirect hosts as Grok Bot and hides the raw name", () => {
    expect(consentClientLabel({ name: "Cursor", redirectUri: "https://www.cursor.com/api/auth/callback" })).toBe("Grok Bot");
    expect(consentClientLabel({ name: "Cursor", redirectUri: "https://cursor.com/callback" })).toBe("Grok Bot");
    expect(consentClientLabel({ name: "Cursor IDE", redirectUri: "https://grok.com/oauth" })).toBe("Grok Bot");
    expect(consentClientLabel({ name: "xAI", redirectUri: "https://grok.x.ai/callback" })).toBe("Grok Bot");
    expect(consentConnectTitle("Grok Bot")).toBe("Connect Grok Bot to Athena");
    expect(consentConnectTitle()).toBe("Connect your AI to Athena");
    expect(consentConnectTitle("your AI")).not.toMatch(/cursor\.com|www\.cursor\.com|Cursor/);
  });

  it("the consent page uses the friendly name and does not show the return domain", () => {
    const page = readFileSync(new URL("../routes/oauth.consent.tsx", import.meta.url), "utf8");
    expect(page).toContain("consentClientLabel");
    expect(page).toContain("consentConnectTitle(clientLabel)");
    expect(page).not.toMatch(/Returns to/);
    expect(page).not.toContain("${clientName}");
    expect(page).not.toContain("www.cursor.com");
  });
});