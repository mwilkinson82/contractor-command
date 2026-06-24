type AuthLinkType = "email" | "magiclink" | "recovery" | "invite";

function cleanOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function safeRelativeRedirect(value?: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function buildTokenHashAuthUrl({
  origin,
  tokenHash,
  type = "email",
  redirect,
}: {
  origin: string;
  tokenHash: string;
  type?: AuthLinkType;
  redirect?: string | null;
}): string {
  const url = new URL("/auth/callback", cleanOrigin(origin));
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type === "magiclink" ? "email" : type);

  const redirectTo = safeRelativeRedirect(redirect);
  if (redirectTo) url.searchParams.set("redirect", redirectTo);

  return url.toString();
}
