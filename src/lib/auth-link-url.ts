import { oauthReturnPath } from "./oauth-return-path";
type AuthLinkType = "email" | "magiclink" | "recovery" | "invite";

function cleanOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

export function buildTokenHashAuthUrl({
  origin,
  tokenHash,
  type = "email",
  redirect,
  continuation,
}: {
  origin: string;
  tokenHash: string;
  type?: AuthLinkType;
  redirect?: string | null;
  continuation?: string;
}): string {
  const url = new URL("/auth/callback", cleanOrigin(origin));
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type === "magiclink" ? "email" : type);

  const redirectTo = redirect ? oauthReturnPath(redirect) : null;
  if (redirectTo) url.searchParams.set("redirect", redirectTo);

  if (continuation) url.searchParams.set("continuation", continuation);
  return url.toString();
}
