// "Your photo" on the account page. A member's own photo shows on the client page of every job they run as PM, so the
// client sees who their project manager is. The browser makes a small square JPEG; Athena's server stores it in the
// member's own private folder and saves it on their profile. The client page server signs it for each visit.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, Upload } from "lucide-react";
import { PHOTO_RULE, checkPhotoFile } from "@/lib/account-photo";
import { getMyPhoto, removeMyPhoto, saveMyPhoto } from "@/lib/people-photo.functions";

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Shrinks the picture to a 512 px square JPEG in the browser, so any phone photo uploads small and the same way. */
async function squareJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("This picture can't be opened here. Save it as a JPG and try again.");
  });
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the photo. Try another browser.");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
  if (!out) throw new Error("This browser can't prepare the photo. Try another browser.");
  return out;
}

export function YourPhoto({ userId, name }: { userId: string | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getFn = useServerFn(getMyPhoto);
  const saveFn = useServerFn(saveMyPhoto);
  const removeFn = useServerFn(removeMyPhoto);

  async function load() {
    if (!userId) return;
    const r = await getFn().catch(() => ({ url: null }));
    setUrl(r.url);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the signed-in member changes
  }, [userId]);

  async function onFile(file: File | undefined) {
    if (!file || !userId) return;
    setMsg(null);
    const check = checkPhotoFile(file);
    if (!check.ok) return setMsg({ tone: "bad", text: check.error });
    setBusy(true);
    try {
      const jpeg = await squareJpeg(file);
      const r = await saveFn({ data: { jpeg: await base64(jpeg) } });
      if (!r.ok) throw new Error(r.error);
      setUrl(r.url);
      setMsg({
        tone: "ok",
        text: "Photo saved. Your clients see it on the client page of your jobs.",
      });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "The photo didn't save." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setMsg(null);
    const r = await removeFn().catch(() => ({ ok: false }));
    if (!r.ok) setMsg({ tone: "bad", text: "The photo didn't come off. Try again." });
    else {
      setUrl(null);
      setMsg({
        tone: "ok",
        text: "Photo removed. Clients see your company logo, or your initials if there is no logo.",
      });
    }
    setBusy(false);
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·";

  return (
    <div className="aa-logo-drop aa-photo-drop">
      <span className="aa-logo-box aa-photo-box" aria-hidden="true">
        {url ? <img src={url} alt="" /> : initials}
      </span>
      <div className="aa-logo-actions">
        <span className="aa-flabel">Your photo</span>
        <span className="aa-hint">
          Clients see it on the client page of the jobs you run, so they know who their project
          manager is. Without one, they see your company logo. {PHOTO_RULE} You can also send your
          photo to Athena in ChatGPT and ask it to set your photo.
        </span>
        <div className="aa-row" style={{ justifyContent: "flex-start", gap: 8 }}>
          <input
            ref={fileRef}
            id="aa-photo-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => void onFile(e.target.files?.[0])}
            disabled={busy || !userId}
            hidden
          />
          <button
            type="button"
            className="aa-btn aa-btn-ghost aa-btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !userId}
          >
            {busy ? <Loader2 size={14} className="aa-spin" /> : <Upload size={14} />}
            {url ? "Replace photo" : "Add your photo"}
          </button>
          {url ? (
            <button
              type="button"
              className="aa-btn aa-btn-ghost aa-btn-sm"
              onClick={() => void remove()}
              disabled={busy}
            >
              <Trash2 size={14} /> Remove
            </button>
          ) : null}
        </div>
        {msg ? (
          <p
            role={msg.tone === "bad" ? "alert" : "status"}
            className={msg.tone === "ok" ? "aa-saved" : "aa-error"}
          >
            {msg.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
