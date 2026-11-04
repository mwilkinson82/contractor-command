import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { preparePhoto } from "@/lib/photo-upload";
import { isIsoDate, shortDay } from "@/lib/progress-photos";

const BUCKET = "athena-progress";

type Result = { name: string; ok: boolean; text: string };

type Loose = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        c: string,
        v: unknown,
      ) => {
        single: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as Loose;

/** Today's calendar date on this device, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The server's "MCP_BAD:..." messages carry a readable sentence after the prefix. */
function readable(message: string | undefined, fallback: string): string {
  const m = /MCP_BAD:(.+)$/.exec(message ?? "");
  return m ? m[1].trim() : fallback;
}

/**
 * Adds original photos straight from the phone or computer to the job's progress photos. Works the same in every
 * browser, so it is also where a chat that can't pass the photo file sends the member.
 */
export type ReplaceTarget = {
  id: string;
  taken_on: string | null;
  area: string | null;
  work: string | null;
  client_safe: boolean;
};

export function AddProgressPhotos({
  jobId,
  date,
  onSaved,
  replaces,
  onCancelReplace,
}: {
  jobId: string;
  date: string | null;
  onSaved: () => void;
  /** Replace this saved photo with one original file; the old one is kept in the record, marked replaced. */
  replaces?: ReplaceTarget | null;
  onCancelReplace?: () => void;
}) {
  const [open, setOpen] = useState(!!replaces);
  const [takenOn, setTakenOn] = useState(replaces?.taken_on ?? date ?? "");
  const [area, setArea] = useState(replaces?.area ?? "");
  const [work, setWork] = useState(replaces?.work ?? "");
  const [clientSafe, setClientSafe] = useState(replaces?.client_safe ?? false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [replaced, setReplaced] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLFormElement>(null);

  // "?add=1" (from Athena in chat) opens the form; "area" fills in where on site.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!takenOn) setTakenOn(date ?? today());
    if (replaces) {
      requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
    } else if (params.get("add") === "1") {
      setOpen(true);
      const a = params.get("area");
      if (a) setArea(a.slice(0, 160));
      requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
    }
    // Runs once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!files.length || !isIsoDate(takenOn) || !area.trim()) return;
    setResults([]);
    setBusy("Checking the job…");
    const job = await db.from("mcp_jobs").select("id,company_id").eq("id", jobId).single();
    const companyId = (job.data as { company_id?: string } | null)?.company_id;
    if (job.error || !companyId) {
      setBusy(null);
      setResults([
        {
          name: "",
          ok: false,
          text: "Athena couldn't confirm your access to this job. Nothing was saved.",
        },
      ]);
      return;
    }
    const out: Result[] = [];
    let saved = 0;
    for (const [n, file] of files.entries()) {
      setBusy(`Saving photo ${n + 1} of ${files.length}…`);
      const ready = await preparePhoto(file);
      if (!ready.ok) {
        out.push({ name: file.name, ok: false, text: `Not saved. ${ready.text}` });
        continue;
      }
      const id = crypto.randomUUID();
      const path = `${companyId}/${jobId}/${id}/progress.${ready.ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, ready.bytes, {
        contentType: ready.mime,
        upsert: false,
        cacheControl: "no-store",
      });
      if (up.error) {
        out.push({ name: file.name, ok: false, text: "Not saved. The upload didn't go through." });
        continue;
      }
      const row = await db.rpc("mcp_progress_photo_create", {
        _id: id,
        _job: jobId,
        _taken: takenOn,
        _area: area.trim(),
        _work: work.trim() || null,
        _sov: null,
        _activity: null,
        _client_safe: clientSafe,
        _path: path,
        _mime: ready.mime,
        _size: ready.bytes.length,
      });
      if (row.error) {
        await supabase.storage.from(BUCKET).remove([path]);
        out.push({
          name: file.name,
          ok: false,
          text: `Not saved. ${readable(row.error.message, "Athena couldn't record it.")}`,
        });
        continue;
      }
      saved++;
      let replacedNote = "";
      if (replaces) {
        const gone = await db.rpc("mcp_progress_photo_remove", {
          _id: replaces.id,
          _reason: "Replaced with the original photo file",
          _replaced_by: id,
        });
        replacedNote = gone.error
          ? ` The old photo wasn't replaced: ${readable(gone.error.message, "Athena couldn't change it.")}`
          : " It replaces the old photo, which is kept in the job's record.";
      }
      out.push({
        name: file.name,
        ok: true,
        text: `Saved, ${ready.info.width} × ${ready.info.height} pixels${ready.scaled ? " (made smaller to fit 8 MB)" : ""}.${replacedNote}`,
      });
    }
    setBusy(null);
    setResults(out);
    if (saved) {
      if (replaces) setReplaced(true);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      onSaved();
    }
  }

  if (!open)
    return (
      <div className="pp-add-open">
        <button type="button" className="pp-primary" onClick={() => setOpen(true)}>
          Add photos
        </button>
      </div>
    );

  const ready =
    files.length > 0 && isIsoDate(takenOn) && area.trim().length > 0 && !busy && !replaced;
  return (
    <form className="pp-add" ref={panel} onSubmit={save} aria-labelledby="pp-add-title">
      <div className="pp-add-head">
        <h2 id="pp-add-title">{replaces ? "Replace a progress photo" : "Add progress photos"}</h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onCancelReplace?.();
          }}
          disabled={!!busy}
        >
          {replaces && !replaced ? "Cancel" : "Close"}
        </button>
      </div>
      <p className="pp-add-note">
        {replaces
          ? `Pick the original photo to replace "${replaces.area ?? "this photo"}". The old one leaves the gallery and the daily but stays in the job's record, marked as replaced.`
          : "Pick the photos straight from your phone or camera roll. Athena keeps the original file at full size."}
      </p>
      <div className="pp-add-fields">
        <label>
          Date taken
          <input
            type="date"
            required
            value={takenOn}
            onChange={(e) => setTakenOn(e.target.value)}
          />
        </label>
        <label className="pp-add-wide">
          Where on site
          <input
            type="text"
            required
            maxLength={160}
            placeholder="e.g. Level 1 office, ceiling"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </label>
        <label className="pp-add-wide">
          What it shows (optional)
          <input
            type="text"
            maxLength={400}
            value={work}
            onChange={(e) => setWork(e.target.value)}
          />
        </label>
        <label className="pp-add-wide">
          Photos
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={!replaces}
            required
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, replaces ? 1 : 20))}
          />
        </label>
        <label className="pp-add-check">
          <input
            type="checkbox"
            checked={clientSafe}
            onChange={(e) => setClientSafe(e.target.checked)}
          />
          Client-safe (can be shown to the owner)
        </label>
      </div>
      <div className="pp-add-actions">
        <button type="submit" className="pp-primary" disabled={!ready}>
          {replaces
            ? "Replace photo"
            : files.length > 1
              ? `Save ${files.length} photos`
              : "Save photo"}
          {isIsoDate(takenOn) ? ` for ${shortDay(takenOn)}` : ""}
        </button>
        {busy && <span role="status">{busy}</span>}
      </div>
      {results.length > 0 && (
        <ul className="pp-add-results" aria-live="polite">
          {results.map((r, n) => (
            <li key={n} className={r.ok ? "ok" : "bad"}>
              {r.name ? <strong>{r.name}: </strong> : null}
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
