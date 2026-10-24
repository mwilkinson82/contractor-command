import { useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { uploadSubmittalPiece, type PieceUploadClient } from "@/lib/submittal-piece-upload";
import { PACKAGE_KINDS, PACKAGE_KIND_LABEL, labelOf, type PackageKind } from "@/lib/mcp/submittals";
import type { SubmittalRecordPayload } from "@/lib/submittal-record-page";
import { duplicatePieceWarnings } from "@/lib/submittal-piece-input";

export function SubmittalPieceUpload({
  payload,
  onSaved,
  client = supabase as unknown as PieceUploadClient,
}: {
  payload: SubmittalRecordPayload;
  onSaved: (payload: SubmittalRecordPayload) => void;
  client?: PieceUploadClient;
}) {
  const [piece, setPiece] = useState("new");
  const [kind, setKind] = useState<PackageKind>("other");
  const [source, setSource] = useState("");
  const [required, setRequired] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const warnings = duplicatePieceWarnings(payload.current.package_items ?? []);
  const selectedDuplicate =
    file &&
    (payload.current.package_items ?? []).some(
      (p) =>
        p.file_ref?.split("/").at(-1)?.normalize("NFKC").toLowerCase() ===
        file.name.normalize("NFKC").toLowerCase(),
    );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !file || !payload.job_id) return;
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      const saved = await uploadSubmittalPiece(client, {
        jobId: payload.job_id,
        number: payload.current.number,
        file,
        ...(piece === "new"
          ? { newPiece: { kind, source_party: source, required } }
          : { pieceId: piece }),
      });
      setReceipt(
        `${saved.ref} · ${saved.filename} stored and attached. Draft, not sent. Rebuild the package to include this file.`,
      );
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      onSaved(saved.payload);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The upload could not be confirmed. Check the record.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="grid min-w-0 gap-4"
      aria-label="Upload a package piece"
      aria-busy={busy}
    >
      <p>
        Attach a received file to a listed piece, or name a new piece and its source. Supplier
        originals and earlier packages are kept.
      </p>
      {warnings.map((warning) => (
        <p
          key={warning.filename}
          role="status"
          className="rounded border-l-4 border-[#1E5FED] bg-gray-50 p-3"
        >
          {warning.message}
        </p>
      ))}
      {selectedDuplicate ? (
        <p role="status" className="rounded border-l-4 border-[#1E5FED] bg-gray-50 p-3">
          Duplicate filename: {file.name} is already on this submittal. Uploading keeps a separate
          copy; check whether both belong in the package.
        </p>
      ) : null}
      <label className="grid min-w-0 gap-1">
        Package piece
        <select
          className="w-full min-w-0 rounded border bg-white p-2"
          value={piece}
          disabled={busy}
          onChange={(e) => setPiece(e.target.value)}
        >
          <option value="new">Add a new piece</option>
          {(payload.current.package_items ?? []).map((p, n) =>
            p.id ? (
              <option key={p.id} value={p.id}>
                P{n + 1} · {labelOf(PACKAGE_KIND_LABEL, p.kind)} · {p.source_party}
              </option>
            ) : null,
          )}
        </select>
      </label>
      {piece === "new" ? (
        <>
          <label className="grid min-w-0 gap-1">
            Kind
            <select
              className="w-full min-w-0 rounded border bg-white p-2"
              value={kind}
              disabled={busy}
              onChange={(e) => setKind(e.target.value as PackageKind)}
            >
              {PACKAGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PACKAGE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1">
            Source (sub, manufacturer or supplier)
            <input
              className="w-full min-w-0 rounded border bg-white p-2"
              required
              maxLength={120}
              value={source}
              disabled={busy}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={required}
              disabled={busy}
              onChange={(e) => setRequired(e.target.checked)}
            />
            Required in the package
          </label>
        </>
      ) : null}
      <label className="grid min-w-0 gap-1">
        Received file (up to 50 MB)
        <input
          ref={fileInput}
          type="file"
          className="max-w-full min-w-0"
          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
          }}
        />
      </label>
      <button
        type="submit"
        disabled={busy || !file || (piece === "new" && !source.trim())}
        className="w-fit rounded bg-[#1E5FED] px-4 py-2 text-white disabled:bg-gray-400"
      >
        {busy ? "Storing…" : "Store and attach piece"}
      </button>
      {error ? (
        <p role="alert" className="rounded border border-gray-300 p-3">
          {error}
        </p>
      ) : null}
      {receipt ? (
        <p role="status" className="break-words rounded border-l-4 border-[#1E5FED] bg-gray-50 p-3">
          {receipt}
        </p>
      ) : null}
    </form>
  );
}
