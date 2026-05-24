/**
 * Schedule Intelligence — Chat shell (AI-1).
 *
 * UI-only. No network calls. No schedule mutation. No AI yet.
 * Pressing send appends a local user message and a deterministic
 * placeholder assistant acknowledgement so the shell can be QA'd.
 *
 * See docs/schedule-intelligence-ai-spec.md §6, §10.
 */

import { useMemo, useRef, useState } from "react";
import {
  INTEL_ADVISORY_NOTE,
  INTEL_STARTER_PROMPTS,
  type IntelScheduleContext,
} from "@/lib/scheduler/intel-context";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface IntelChatPanelProps {
  context: IntelScheduleContext;
  /** When true, the input is disabled and shows a loading indicator. */
  loading?: boolean;
  /**
   * Optional hook for future wiring to a server function. AI-1 ignores
   * the return value beyond letting the panel show a placeholder reply.
   * If omitted, the panel runs in fully local "shell" mode.
   */
  onSend?: (message: string, context: IntelScheduleContext) => void;
}

export function IntelChatPanel({ context, loading, onSend }: IntelChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const idRef = useRef(0);

  const nextId = () => {
    idRef.current += 1;
    return `m${idRef.current}`;
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || loading) return;
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    const ack: ChatMessage = {
      id: nextId(),
      role: "assistant",
      content:
        "Captured. Schedule context is prepared, but assistant responses are not wired yet (AI-1 is UI/context only).",
    };
    setMessages((prev) => [...prev, userMsg, ack]);
    setInput("");
    onSend?.(text, context);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const summary = useMemo(() => {
    const c = context.counts;
    return `${c.activities} activities · ${c.critical} critical · ${c.nearCritical} near-critical`;
  }, [context]);

  return (
    <div
      className="flex h-full flex-1 flex-col text-[12px] text-[#3a3a35]"
      data-testid="intel-chat-panel"
    >
      <div className="border-b border-[#ece8db] bg-[#fdfcf7] px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
          Schedule Context
        </div>
        <div className="mt-1 text-[11px] text-[#4a4944]">
          {context.projectName ?? "Untitled schedule"} · {summary}
        </div>
        {context.selectedActivity ? (
          <div className="mt-0.5 text-[10.5px] text-[#6b6a63]">
            Selected: {context.selectedActivity.id} · {context.selectedActivity.name}
          </div>
        ) : null}
      </div>

      <div
        className="flex-1 space-y-2 overflow-auto px-3 py-3"
        data-testid="intel-chat-messages"
      >
        {messages.length === 0 ? (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
              Try a starter
            </div>
            <ul className="space-y-1">
              {INTEL_STARTER_PROMPTS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => send(p)}
                    disabled={loading}
                    className="w-full rounded border border-[#ece8db] bg-white/70 px-2 py-1.5 text-left text-[11.5px] text-[#1f241f] hover:border-[#1f241f] hover:bg-white disabled:opacity-50"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-[#1f241f] px-2.5 py-1.5 text-[11.5px] text-[#f7e9b8]"
                  : "mr-auto max-w-[85%] rounded-lg border border-[#ece8db] bg-white/80 px-2.5 py-1.5 text-[11.5px] text-[#1f241f]"
              }
            >
              {m.content}
            </div>
          ))
        )}
        {loading ? (
          <div className="mr-auto rounded-lg border border-[#ece8db] bg-white/80 px-2.5 py-1.5 text-[11px] text-[#6b6a63]">
            Thinking…
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-[#ece8db] bg-white px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this schedule…"
            disabled={loading}
            aria-label="Ask the schedule assistant"
            className="flex-1 rounded border border-[#ece8db] bg-[#fdfcf7] px-2 py-1.5 text-[12px] text-[#1f241f] outline-none focus:border-[#1f241f] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || input.trim().length === 0}
            className="rounded bg-[#1f241f] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#f7e9b8] disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <div className="mt-1.5 text-[10px] text-[#8a8980]">
          {INTEL_ADVISORY_NOTE}
        </div>
      </form>
    </div>
  );
}

export function IntelBuildPanel() {
  return (
    <div
      className="flex h-full flex-1 flex-col items-start gap-2 overflow-auto px-3 py-4 text-[12px] text-[#3a3a35]"
      data-testid="intel-build-panel"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#675d4b]">
        Build — coming soon
      </div>
      <p className="text-[11.5px] leading-relaxed text-[#4a4944]">
        The CPM builder will let you draft activities, WBS, and logic from a
        scope narrative, activity list, or schedule of values, then stage the
        result as a reviewable change set. Nothing here writes to the live
        schedule.
      </p>
      <ul className="ml-4 list-disc space-y-1 text-[11px] text-[#6b6a63]">
        <li>Propose WBS &amp; activities from input</li>
        <li>Suggest durations and predecessors</li>
        <li>Surface assumptions and open questions</li>
        <li>Approve, edit, then commit (future phases)</li>
      </ul>
      <div className="mt-2 text-[10px] text-[#8a8980]">
        {INTEL_ADVISORY_NOTE}
      </div>
    </div>
  );
}
