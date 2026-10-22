import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postLoginDestination } from "./post-login-destination";

const HUB = "app.alpcontractorcircle.com";
const ATHENA = "app.meetathena.io";

describe("post-login stays on the host that started sign-in", () => {
  it("Hub login lands on a Hub page and ignores an Athena returnTo", () => {
    expect(postLoginDestination(HUB)).toBe("/");
    expect(postLoginDestination(HUB, "/calls")).toBe("/calls");
    expect(postLoginDestination(HUB, "/vault")).toBe("/vault");
    expect(postLoginDestination(HUB, "https://app.meetathena.io/account")).toBe("/");
    expect(postLoginDestination(HUB, "https://app.meetathena.io/r/job/1/items")).toBe("/");
    expect(postLoginDestination(HUB, "//app.meetathena.io/account")).toBe("/");
    expect(postLoginDestination("contractor-command.lovable.app", "/")).toBe("/");
    expect(postLoginDestination("contractor-command.lovable.app", "https://app.meetathena.io/login")).toBe("/");
  });

  it("Athena login lands on an Athena page and ignores a Hub returnTo", () => {
    expect(postLoginDestination(ATHENA)).toBe("/account");
    expect(postLoginDestination(ATHENA, "/")).toBe("/account");
    expect(postLoginDestination(ATHENA, "/calls")).toBe("/account");
    expect(postLoginDestination(ATHENA, "/onboarding")).toBe("/account");
    expect(postLoginDestination(ATHENA, "/upgrade")).toBe("/account");
    expect(postLoginDestination(ATHENA, "https://app.alpcontractorcircle.com/")).toBe("/account");
    expect(postLoginDestination(ATHENA, "https://app.alpcontractorcircle.com/calls")).toBe("/account");
    expect(postLoginDestination(ATHENA, "/account")).toBe("/account");
    expect(postLoginDestination(ATHENA, "/today")).toBe("/today");
    expect(postLoginDestination(ATHENA, "/oauth/consent?authorization_id=abc")).toBe(
      "/oauth/consent?authorization_id=abc",
    );
  });

  it("login, callback, and reset-password use the same-host landing", () => {
    const login = readFileSync(new URL("../routes/login.tsx", import.meta.url), "utf8");
    const callback = readFileSync(new URL("../routes/auth.callback.tsx", import.meta.url), "utf8");
    const reset = readFileSync(new URL("../routes/reset-password.tsx", import.meta.url), "utf8");
    expect(login).toContain("postLoginDestination(currentHostname(), search.redirect)");
    expect(login).toContain("postLoginDestination(window.location.hostname, redirectTo)");
    expect(callback).toContain("postLoginDestination(window.location.hostname, destination ?? redirect)");
    expect(reset).toContain("postLoginDestination(window.location.hostname)");
    expect(login).not.toContain("https://app.meetathena.io");
    expect(callback).not.toContain("https://app.meetathena.io");
  });
});
