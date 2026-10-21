import * as React from "react";
import { AthenaAuthEmail, athenaAuthSubject, type AthenaAuthKind } from "@/lib/email-templates/athena-auth-email";

// Auth-hook action types (Supabase) mapped to the Athena email kind.
const HOOK_KIND: Record<string, AthenaAuthKind> = {
  signup: "signup",
  invite: "invite",
  magiclink: "magiclink",
  recovery: "recovery",
  email_change: "email_change",
  reauthentication: "code",
};

export function athenaHookKind(emailType: string): AthenaAuthKind | null {
  return HOOK_KIND[emailType] ?? null;
}

/** Element + subject for an Athena auth-hook email, or null for unknown types. */
export function athenaHookEmail(
  emailType: string,
  data: { url?: string; token?: string; new_email?: string },
): { element: React.ReactElement; subject: string } | null {
  const kind = athenaHookKind(emailType);
  if (!kind) return null;
  const element = React.createElement(AthenaAuthEmail, {
    kind,
    confirmationUrl: data.url,
    // Typed code: reauthentication is code-only; a sign-in link also carries it.
    code: kind === "code" || kind === "magiclink" ? data.token || undefined : undefined,
    newEmail: data.new_email,
  });
  return { element, subject: athenaAuthSubject(kind) };
}
