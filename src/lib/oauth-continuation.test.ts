import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthContinuation, verifyOAuthContinuation } from "./oauth-continuation.server";
import { oauthConsentReturn, oauthReturnPath } from "./oauth-return-path";
import { buildTokenHashAuthUrl } from "./auth-link-url";
beforeEach(() =>
  vi.stubEnv("OAUTH_CONTINUATION_SECRET", "synthetic-test-secret-at-least-32-characters"),
);
afterEach(() => vi.unstubAllEnvs());
const path = "/oauth/consent?authorization_id=request_A";
describe("signed email continuation (no browser storage)", () => {
  it("survives a fresh browser and keeps concurrent requests separate", () => {
    const a = createOAuthContinuation(path, "alice", "link-A", 100);
    const b = createOAuthContinuation(
      "/oauth/consent?authorization_id=request_B",
      "alice",
      "link-B",
      100,
    );
    const emailed = new URL(
      buildTokenHashAuthUrl({
        origin: "https://example.test",
        tokenHash: "link-A",
        continuation: a,
      }),
    );
    expect(
      verifyOAuthContinuation(emailed.searchParams.get("continuation")!, "alice", "link-A", 101),
    ).toBe(path);
    expect(verifyOAuthContinuation(b, "alice", "link-B", 101)).toContain("request_B");
    expect(verifyOAuthContinuation(a, "alice", "link-B", 101)).toBeNull();
  });
  it("rejects account switching, tampering, expiry and unavailable signing configuration", () => {
    const signed = createOAuthContinuation(path, "alice", "link-A", 100);
    expect(verifyOAuthContinuation(signed, "bob", "link-A", 101)).toBeNull();
    expect(verifyOAuthContinuation(signed + "x", "alice", "link-A", 101)).toBeNull();
    expect(verifyOAuthContinuation(signed, "alice", "link-A", 1800100)).toBeNull();
    vi.stubEnv("OAUTH_CONTINUATION_SECRET", "");
    expect(verifyOAuthContinuation(signed, "alice", "link-A", 101)).toBeNull();
    expect(() => createOAuthContinuation(path, "alice", "link-A")).toThrow();
  });
  it.each([
    "//evil.test",
    "/\\evil.test",
    "https://evil.test",
    "/oauth/consent-other?authorization_id=a",
    "/oauth/consent?authorization_id=a&authorization_id=b",
    "/oauth/consent?authorization_id=a&redirect=https://evil.test",
    "/oauth/consent?authorization_id=a#x",
    "/oauth/consent",
    "/oauth/consent?authorization_id=%0Afoo",
  ])("rejects continuation %s", (value) => {
    expect(oauthConsentReturn(value)).toBeUndefined();
    expect(() => createOAuthContinuation(value, "alice", "link-A")).toThrow();
  });
  it.each(["//evil.test", "/\\evil.test", "https://evil.test", "/\nevil.test"])(
    "rejects general redirect %s",
    (value) => {
      expect(oauthReturnPath(value)).toBe("/");
      expect(
        new URL(
          buildTokenHashAuthUrl({
            origin: "https://example.test",
            tokenHash: "fake",
            redirect: value,
          }),
        ).searchParams.get("redirect"),
      ).toBe("/");
    },
  );
});
