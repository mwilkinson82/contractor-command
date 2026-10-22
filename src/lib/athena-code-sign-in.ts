// Athena sign-in finishes in the same tab: email an 8-digit code, type it,
// verifyOtp, then follow only a same-origin relative redirect.
import { postSignInDefault } from "./athena-routes";
import { normalizeOtpCode } from "./login-otp";
import { oauthReturnPath } from "./oauth-return-path";

export const ATHENA_SIGN_IN_CODE_LENGTH = 8;

const ENTER_CODE = "Enter the 8-digit code from the email.";
const CODE_REJECTED = "That code didn't work. Use the newest email.";

export function athenaEmailCode(raw: string): string | null {
  const token = normalizeOtpCode(raw);
  return token && token.length === ATHENA_SIGN_IN_CODE_LENGTH ? token : null;
}

/**
 * Where to send the member after the code verifies.
 * Same-origin relative paths only. The query string and hash are kept.
 * Anything else (other origins, protocol-relative URLs) uses the app default.
 */
export function athenaCodeSignInDestination(
  redirectTo: string | undefined,
  onAthenaHost: boolean,
): string {
  const fallback = postSignInDefault(onAthenaHost);
  if (typeof redirectTo !== "string" || redirectTo.length === 0) return fallback;
  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) return fallback;
  const safe = oauthReturnPath(redirectTo);
  if (!safe.startsWith("/") || safe.startsWith("//")) return fallback;
  // oauthReturnPath collapses rejected values to "/". Don't follow that
  // collapse when the caller asked for a different path.
  if (
    safe === "/" &&
    redirectTo !== "/" &&
    !redirectTo.startsWith("/?") &&
    !redirectTo.startsWith("/#")
  ) {
    return fallback;
  }
  return safe;
}

type VerifyEmailCode = (input: {
  email: string;
  token: string;
  type: "email";
}) => Promise<{ error: { message?: string } | null }>;

export async function completeAthenaCodeSignIn(args: {
  email: string;
  code: string;
  redirectTo: string | undefined;
  onAthenaHost: boolean;
  verify: VerifyEmailCode;
  assign: (url: string) => void;
}): Promise<{ ok: true; destination: string } | { ok: false; message: string }> {
  const token = athenaEmailCode(args.code);
  if (!token) return { ok: false, message: ENTER_CODE };
  try {
    const { error } = await args.verify({ email: args.email.trim(), token, type: "email" });
    if (error) return { ok: false, message: CODE_REJECTED };
  } catch {
    return { ok: false, message: CODE_REJECTED };
  }
  const destination = athenaCodeSignInDestination(args.redirectTo, args.onAthenaHost);
  args.assign(destination);
  return { ok: true, destination };
}
