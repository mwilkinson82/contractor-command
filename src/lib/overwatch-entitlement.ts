import { createHmac, timingSafeEqual } from "node:crypto";

const INCLUDED_TIERS = new Set(["circle", "hardcore"]);

export function isOverwatchIncludedTier(tier: string | null | undefined): boolean {
  return Boolean(tier && INCLUDED_TIERS.has(tier));
}

export function overwatchEntitlementSigningString({
  email,
  ts,
  nonce,
}: {
  email: string;
  ts: number;
  nonce: string;
}): string {
  return `${email.trim().toLowerCase()}|${ts}|${nonce}`;
}

function safeEqualHex(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function verifyOverwatchEntitlementSignature({
  signature,
  signingString,
  secrets,
}: {
  signature: string;
  signingString: string;
  secrets: string[];
}): boolean {
  return secrets.some((secret) =>
    safeEqualHex(signature, createHmac("sha256", secret).update(signingString).digest("hex")),
  );
}
