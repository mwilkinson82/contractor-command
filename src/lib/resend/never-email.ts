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

export function shouldSkipResendCapture(input: NeverEmailInput): boolean {
  const email = input.email.trim().toLowerCase();
  if (NEVER_EMAIL.has(email)) return true;

  const haystack = [email, input.firstName, input.lastName, input.company]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
  return PRO_BUILD_RE.test(haystack);
}
