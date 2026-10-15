import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCircleSessions,
  saveCircleSession,
  cancelCircleSession,
} from "@/lib/circle-sessions/sessions.functions";
import { localDateTime, sessionLabel, type SessionRow } from "@/lib/circle-sessions/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CircleSessionPicker({
  selection,
  onChange,
}: {
  selection?: { id: string; version: number };
  onChange: (value?: { id: string; version: number }) => void;
}) {
  const list = useServerFn(adminCircleSessions);
  const save = useServerFn(saveCircleSession);
  const cancel = useServerFn(cancelCircleSession);
  const query = useQuery({
    queryKey: ["admin-circle-sessions"],
    queryFn: () => list(),
    retry: false,
  });
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("Contractor Circle working session");
  const [localStart, setLocalStart] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [durationMin, setDurationMin] = useState(90);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const future = (query.data ?? []).filter(
    (s) => s.status === "scheduled" && Date.parse(s.starts_at) > Date.now(),
  );
  const selected = future.find((s) => s.id === selection?.id);
  function edit(row: SessionRow | null) {
    setEditing(row);
    setShowForm(true);
    setError("");
    setTitle(row?.title ?? "Contractor Circle working session");
    setLocalStart(row ? localDateTime(row.starts_at, row.time_zone) : "");
    setTimeZone(row?.time_zone ?? "America/New_York");
    setDurationMin(row?.duration_min ?? 90);
    setMeetingUrl(row?.meeting_url ?? "");
    setDescription(row?.description ?? "");
  }
  async function persist() {
    setBusy(true);
    setError("");
    try {
      const row = await save({
        data: {
          id: editing?.id,
          expectedVersion: editing?.version,
          title,
          localStart,
          timeZone,
          durationMin,
          meetingUrl,
          description,
          kind: editing?.kind ?? "Biweekly Call",
        },
      });
      await query.refetch();
      onChange({ id: row.id, version: row.version });
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function cancelSelected() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await cancel({ data: { id: selected.id, version: selected.version } });
      onChange(undefined);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <label className="block text-sm">
        Confirmed session
        <select
          className="mt-2 w-full rounded border bg-background p-2"
          value={selection?.id ?? ""}
          onChange={(e) => {
            const row = future.find((s) => s.id === e.target.value);
            onChange(row ? { id: row.id, version: row.version } : undefined);
          }}
        >
          <option value="">Select a session</option>
          {future.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} — {sessionLabel(s)}
            </option>
          ))}
        </select>
      </label>
      {selection && (!selected || selected.version !== selection.version) && (
        <p role="alert">Session changed or is no longer available. Select it again and preview.</p>
      )}
      {query.error && <p role="alert">{query.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          Refresh sessions
        </Button>
        <Button type="button" variant="outline" onClick={() => edit(null)}>
          Enter an actual session
        </Button>
        {selected && !selected.calendar_event_id && (
          <Button type="button" variant="outline" onClick={() => edit(selected)}>
            Edit session
          </Button>
        )}
        {selected && (
          <Button type="button" variant="outline" disabled={busy} onClick={cancelSelected}>
            Cancel in Hub
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Saving publishes these details on the Hub. Each session needs its own Meet link.
        Calendar-managed events must be changed in Calendar and synced; canceling here does not
        cancel the Calendar event.
      </p>
      {showForm && (
        <div className="space-y-3">
          <label className="block text-sm">
            Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-sm">
            Date and local time
            <Input
              type="datetime-local"
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Time zone
            <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
          </label>
          <label className="block text-sm">
            Duration in minutes
            <Input
              type="number"
              min={15}
              max={480}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </label>
          <label className="block text-sm">
            Unique Google Meet URL
            <Input
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://meet.google.com/…"
            />
          </label>
          <label className="block text-sm">
            Description
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <Button type="button" disabled={busy} onClick={persist}>
            {busy ? "Saving…" : "Save session to Hub"}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
