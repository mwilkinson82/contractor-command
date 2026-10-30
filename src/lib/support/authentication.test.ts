import { expect, it } from "vitest";
import { senderAuthentication, originalEvidence } from "./conversation.ts";

it("uses only receiver-computed verdicts and requires From alignment", () => {
  for (const authentication of [
    null,
    {},
    { spf: "pass" },
    { dkim: "gray" },
    { dmarc: "gray", spf: "pass" },
    { dmarc: "processing_failed" },
  ]) {
    expect(
      senderAuthentication({
        from: "pat@example.com",
        authentication,
        headers: { "Authentication-Results": "trusted.example; dkim=pass; dmarc=pass" },
      }).verified,
    ).toBe(false);
  }
  for (const authentication of [
    { dmarc: "pass" },
    { dkim: "pass" },
    { dmarc: "gray", dkim: "pass" },
  ]) {
    expect(senderAuthentication({ from: "pat@example.com", authentication }).verified).toBe(true);
  }
  expect(
    senderAuthentication({
      from: "pat@example.com",
      authentication: { dkim: "pass", dmarc: "fail" },
    }),
  ).toMatchObject({ verified: false, failed: true });
});

it("persists bounded provider verdicts without copying arbitrary authentication headers", () => {
  const evidence = originalEvidence({
    from: "pat@example.com",
    authentication: { dmarc: "pass", spf: "unexpected secret" },
    headers: { "Authentication-Results": "forged secret" },
  });
  expect(evidence.provider_authentication).toMatchObject({
    dmarc: "pass",
    spf: "unknown",
    verified: true,
  });
  expect(JSON.stringify(evidence)).not.toContain("secret");
});
