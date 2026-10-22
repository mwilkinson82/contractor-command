// Athena host only. The Hub client keeps the storage object it already had.
// The session stays in localStorage (persistSession). A long-lived first-party
// cookie is a second copy so a return visit can restore it when localStorage
// was cleared. The cookie is host-only (no Domain attribute), SameSite=Lax.

import type { PreviewAuthStorage } from "./previewAuthStorage";

const VALUE = "athena_session";
const KEY = "athena_session_key";
const MAX_AGE = 60 * 60 * 24 * 400;
const MAX_CHARS = 3500;

export function onAthenaSite(): boolean {
  if (typeof window === "undefined") return false;
  const host = location.hostname.toLowerCase();
  return host === "meetathena.io" || host.endsWith(".meetathena.io");
}

function isAuthKey(key: string): boolean {
  return key.startsWith("sb-") && key.endsWith("-auth-token");
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Shrink a stored session so it fits in a cookie. The refresh token is the part that lasts. */
export function compactSession(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
      token_type?: string;
      user?: { id?: string; email?: string; aud?: string; role?: string };
    };
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) return null;
    const small = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: parsed.expires_at ?? null,
      expires_in: parsed.expires_in ?? null,
      token_type: parsed.token_type ?? "bearer",
      user: {
        id: parsed.user.id,
        aud: parsed.user.aud ?? "authenticated",
        role: parsed.user.role ?? "authenticated",
        email: parsed.user.email ?? null,
        app_metadata: {},
        user_metadata: {},
      },
    };
    const text = JSON.stringify(small);
    return text.length <= MAX_CHARS ? text : null;
  } catch {
    return null;
  }
}

function remember(key: string, raw: string) {
  const stored = raw.length <= MAX_CHARS ? raw : compactSession(raw);
  if (!stored) return;
  writeCookie(KEY, key);
  writeCookie(VALUE, stored);
}

/**
 * Write a session the Athena host can read on the next page load.
 * localStorage is what the auth client loads. The cookie is the same backup
 * the storage wrapper keeps when the client writes a session itself.
 */
export function persistAuthRecord(key: string, raw: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* private mode: the cookie copy below still counts on the Athena host */
  }
  if (onAthenaSite() && isAuthKey(key)) remember(key, raw);
}

/** Put the cookie copy back into localStorage before the auth client reads it. */
export function restoreAthenaSessionFromCookie() {
  if (!onAthenaSite()) return;
  const key = readCookie(KEY);
  const raw = readCookie(VALUE);
  if (!key || !raw || !isAuthKey(key)) return;
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key, raw);
  } catch {
    /* storage blocked: getItem below still returns the cookie */
  }
}

type StoredSession = { access_token?: string; refresh_token?: string; user?: { id?: string } };

/** Session already on this phone, if the Athena host has one. */
export function readStoredAthenaSession(): StoredSession | null {
  if (!onAthenaSite()) return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isAuthKey(key)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed?.access_token && parsed.user?.id) return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function withPersistentSession(
  storage: PreviewAuthStorage | undefined,
): PreviewAuthStorage | undefined {
  if (!storage || !onAthenaSite()) return storage;
  return {
    getItem: (key) => {
      const local = storage.getItem(key);
      const finish = (value: string | null) => {
        if (value && isAuthKey(key)) remember(key, value);
        return value;
      };
      if (local && typeof (local as Promise<string | null>).then === "function") {
        return (local as Promise<string | null>).then((value) => {
          if (value) return finish(value);
          if (!isAuthKey(key)) return value;
          const cookie = readCookie(VALUE);
          const cookieKey = readCookie(KEY);
          if (cookie && cookieKey === key) {
            try {
              localStorage.setItem(key, cookie);
            } catch {
              /* still return it */
            }
            return cookie;
          }
          return value;
        });
      }
      if (local) return finish(local as string);
      if (!isAuthKey(key)) return local as string | null;
      const cookie = readCookie(VALUE);
      const cookieKey = readCookie(KEY);
      if (cookie && cookieKey === key) {
        try {
          localStorage.setItem(key, cookie);
        } catch {
          /* still return it */
        }
        return cookie;
      }
      return null;
    },
    setItem: (key, value) => {
      const result = storage.setItem(key, value);
      if (isAuthKey(key)) remember(key, value);
      return result;
    },
    removeItem: (key) => {
      const result = storage.removeItem(key);
      if (isAuthKey(key)) {
        clearCookie(KEY);
        clearCookie(VALUE);
      }
      return result;
    },
  };
}
