import { describe, expect, it } from "vitest";
import { consentForwardUrl } from "./consent-forward";

const req = (url: string, host?: string, method = "GET") => new Request(url, { method, headers: host ? { host } : {} });

describe("consent forward (hub -> app.meetathena.io)", () => {
  it("forwards hub consent links with authorization_id, keeping the query string", () => {
    expect(consentForwardUrl(req("https://app.alpcontractorcircle.com/oauth/consent?authorization_id=abc-123&x=1"))).toBe(
      "https://app.meetathena.io/oauth/consent?authorization_id=abc-123&x=1",
    );
  });
  it("uses the forwarded host behind the proxy", () => {
    expect(consentForwardUrl(new Request("https://internal/oauth/consent?authorization_id=a", { headers: { "x-forwarded-host": "app.alpcontractorcircle.com" } }))).toBe(
      "https://app.meetathena.io/oauth/consent?authorization_id=a",
    );
  });
  it("leaves everything else alone", () => {
    expect(consentForwardUrl(req("https://app.alpcontractorcircle.com/oauth/consent"))).toBeNull();
    expect(consentForwardUrl(req("https://app.alpcontractorcircle.com/oauth/consent?authorization_id="))).toBeNull();
    expect(consentForwardUrl(req("https://app.alpcontractorcircle.com/login?authorization_id=a"))).toBeNull();
    expect(consentForwardUrl(req("https://app.meetathena.io/oauth/consent?authorization_id=a"))).toBeNull();
    expect(consentForwardUrl(req("https://app.alpcontractorcircle.com/oauth/consent?authorization_id=a", undefined, "POST"))).toBeNull();
  });
});
