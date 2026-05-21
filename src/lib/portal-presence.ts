// Shared store for portal presence. The channel is created/subscribed in
// __root.tsx (where every signed-in user joins). A presence "sync" listener
// must be attached BEFORE .subscribe() — otherwise presenceState() stays
// empty on this client, even when other users are tracking themselves.
// This module is the single source of truth that any page (e.g. admin) can
// read from.

export type PresenceUser = {
  user_id: string;
  email: string | null;
  at: string;
};

let current: PresenceUser[] = [];
const listeners = new Set<(users: PresenceUser[]) => void>();

export function setPresence(state: Record<string, PresenceUser[]>) {
  const seen = new Set<string>();
  const flat: PresenceUser[] = [];
  for (const arr of Object.values(state)) {
    for (const p of arr) {
      if (!p?.user_id || seen.has(p.user_id)) continue;
      seen.add(p.user_id);
      flat.push(p);
    }
  }
  current = flat;
  for (const cb of listeners) cb(current);
}

export function getPresence(): PresenceUser[] {
  return current;
}

export function subscribePresence(cb: (users: PresenceUser[]) => void) {
  listeners.add(cb);
  cb(current);
  return () => {
    listeners.delete(cb);
  };
}

export function resetPresence() {
  current = [];
  for (const cb of listeners) cb(current);
}
