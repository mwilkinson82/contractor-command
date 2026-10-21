// One-time sign-in code typed on the login page (same-tab connect finish).
export function normalizeOtpCode(raw: string): string | null {
  const digits = raw.replace(/\s+/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : null;
}
