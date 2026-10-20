// 0.8.10: /login copy, gated by brand. On Athena domains (meetathena.io, app.meetathena.io) and the connector
// sign-in, the page is Athena's: "Sign in to Athena" and no Hub wording. The Hub domain keeps its copy unchanged.

/** Athena blue brand tokens for the Athena sign-in shell. */
export const ATHENA_LOGIN_COLORS = Object.freeze({
  blue: "#2563EB",
  deepBlue: "#1D4ED8",
  paleBlue: "#DBEAFE",
  ink: "#1F2329",
  white: "#FFFFFF",
});

export const ATHENA_LOGIN_LOGO = "/brand/athena/athena-lockup-blue.svg";

export type LoginCopyInput = { athena: boolean; fromConnect: boolean; magicRequested: boolean; email?: string };

export function loginCopy({ athena, fromConnect, magicRequested, email = "" }: LoginCopyInput) {
  const title = magicRequested
    ? "Request received."
    : fromConnect
      ? "Sign in to approve the connection."
      : athena
        ? "Sign in to Athena"
        : "Sign in to the Hub.";
  const subtitle = magicRequested
    ? `If this address is eligible and email delivery is available, you will receive a secure sign-in link. Check the spelling of ${email}, or sign in with your password.`
    : athena
      ? "No password required. Use the email associated with your Athena account."
      : "No password required. Use the email associated with your membership.";
  return { title, subtitle };
}
