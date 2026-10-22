import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { iosPushHint } from "@/lib/mcp/field-push";
import { BLUE, GRAY, NAVY } from "@/lib/mcp/cards/palette";

async function authHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** User-level morning briefing. Stays off the job daily reminder. */
export function MorningBriefPushBar({ showBoardLink = true }: { showBoardLink?: boolean }) {
  const [hint, setHint] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setHint(iosPushHint(navigator.userAgent, standalone));
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/athena-field-sw.js");
    }
    let alive = true;
    void (async () => {
      try {
        const header = await authHeader();
        if (!header || !alive) return;
        const res = await fetch("/api/athena/morning-brief?status=1", { headers: { Authorization: header } });
        if (!res.ok || !alive) return;
        const body = (await res.json()) as { subscribed?: boolean };
        if (alive && body.subscribed) setOn(true);
      } catch {
        // The button still turns the briefing on.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const header = await authHeader();
      if (!header) {
        setNote("Sign in to turn on the morning briefing.");
        return;
      }
      if (hint) return;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNote("Notifications stay off until you allow them.");
        return;
      }
      const keyRes = await fetch("/api/athena/morning-brief?vapid=1", { headers: { Authorization: header } });
      const keyBody = (await keyRes.json()) as { publicKey?: string; error?: string };
      if (!keyRes.ok || !keyBody.publicKey) {
        setNote(keyBody.error || "Morning briefing is not configured yet.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) as BufferSource,
      });
      const saved = await fetch("/api/athena/morning-brief", {
        method: "POST",
        headers: { Authorization: header, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }),
      });
      const body = (await saved.json()) as { error?: string };
      if (saved.ok) {
        setOn(true);
        setNote("Morning briefing is on for this browser.");
      } else {
        setNote(body.error || "Could not save the morning briefing.");
      }
    } catch {
      setNote("Could not turn on the morning briefing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-screen="morning-brief-push"
      style={{ maxWidth: 640, margin: "0 auto", padding: "12px 16px 0", fontFamily: "system-ui, sans-serif" }}
    >
      {hint ? <p style={{ margin: "0 0 8px", color: GRAY, fontSize: 14 }}>{hint}</p> : null}
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy}
        style={{ background: BLUE, color: "#fff", border: 0, borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}
      >
        {on ? "Morning briefing is on" : "Turn on morning briefing"}
      </button>
      {showBoardLink ? (
        <a href="/today" style={{ marginLeft: 12, color: NAVY, fontWeight: 700, fontSize: 14 }}>
          Open today's brief
        </a>
      ) : null}
      {note ? <p style={{ margin: "8px 0 0", color: NAVY, fontSize: 14 }}>{note}</p> : null}
    </div>
  );
}
