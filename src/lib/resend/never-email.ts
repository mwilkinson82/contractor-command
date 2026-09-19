const NEVER_EMAIL = new Set([
  "bryan@bettencourtconstruction.com",
  "nav@fiveriversig.com",
  "roberto@vegadevelopment.net",
]);

/**
 * Match Pro-Build / ProBuild / Pro Build only.
 * Does not skip other *Builders* companies (e.g. "ABC Builders", "Pro Builders").
 */
const PRO_BUILD_RE = /\bpro[\s-]?build\b/i;

export type NeverEmailInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
};

export function resendCaptureSkipReason(input: NeverEmailInput): string | null {
  const email = input.email.trim().toLowerCase();
  if (NEVER_EMAIL.has(email)) return "never-email";

  const haystack = [email, input.firstName, input.lastName, input.company]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
  if (PRO_BUILD_RE.test(haystack)) return "pro-build";
  return null;
}

export function shouldSkipResendCapture(input: NeverEmailInput): boolean {
  return resendCaptureSkipReason(input) !== null;
}
