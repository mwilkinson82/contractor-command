import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";
import {
  listThreads,
  getThread,
  deleteThread,
  expressIntensiveInterest,
  type AskMessage,
} from "@/lib/ask.functions";
import { createIntensiveCheckout } from "@/lib/billing.functions";
import { ArrowUp, Plus, Trash2, MessageCircle, Check, Sparkles, Megaphone, Copy, BookOpen, Brain, Wand2, CheckCircle2, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/ask/$threadId")({
  head: () => ({
    meta: [{ title: "Ask Marshall" }],
  }),
  component: AskThreadPage,
});

function toUIMessages(rows: AskMessage[]): UIMessage[] {
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      parts: [{ type: "text", text: r.content }],
    }));
}

function AskThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();

  const getThreadFn = useServerFn(getThread);
  const listThreadsFn = useServerFn(listThreads);
  const deleteThreadFn = useServerFn(deleteThread);

  const { data: threadData } = useQuery({
    queryKey: ["ask-thread", threadId],
    queryFn: () => getThreadFn({ data: { threadId } }),
  });

  const { data: threads, refetch: refetchThreads } = useQuery({
    queryKey: ["ask-threads"],
    queryFn: () => listThreadsFn(),
  });

  const initialMessages = useMemo(
    () => (threadData ? toUIMessages(threadData.messages) : []),
    [threadData],
  );

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[260px_1fr]">
      {/* Thread sidebar */}
      <aside className="hidden border-r border-border bg-card/40 md:flex md:flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Conversations
          </p>
          <Link
            to="/ask/new"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> New
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {(threads ?? []).map((t) => (
            <div
              key={t.id}
              className={`group flex items-center justify-between gap-2 px-3 py-2 text-[13px] ${
                t.id === threadId ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <Link
                to="/ask/$threadId"
                params={{ threadId: t.id }}
                className="min-w-0 flex-1 truncate"
              >
                {t.title}
              </Link>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Delete this conversation?")) return;
                  await deleteThreadFn({ data: { threadId: t.id } });
                  await refetchThreads();
                  if (t.id === threadId) navigate({ to: "/ask" });
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Delete"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
          {threads && threads.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-muted-foreground">
              No conversations yet.
            </p>
          )}
        </div>
      </aside>

      {threadData ? (
        <ChatPane
          key={threadId}
          threadId={threadId}
          initialMessages={initialMessages}
          loaded={true}
          onTitleMayHaveChanged={() => refetchThreads()}
        />
      ) : (
        <div className="grid place-items-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Loading…
          </p>
        </div>
      )}
    </div>
  );
}

function ChatPane({
  threadId,
  initialMessages,
  loaded,
  onTitleMayHaveChanged,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  loaded: boolean;
  onTitleMayHaveChanged: () => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ask",
        body: { threadId },
        fetch: async (input, init) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers = new Headers(init?.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      }),
    [threadId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentFirstRef = useRef(false);

  // Auto-send a first message handed over from the home prompt (router state).
  useEffect(() => {
    if (!loaded || sentFirstRef.current) return;
    const state = (window.history.state ?? {}) as { firstMessage?: string };
    const first = state.firstMessage?.trim();
    if (first && initialMessages.length === 0) {
      sentFirstRef.current = true;
      void sendMessage({ text: first });
      const { firstMessage: _drop, ...rest } = state;
      window.history.replaceState(rest, "");
    }
  }, [loaded, initialMessages.length, sendMessage]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  // Refresh thread list when assistant finishes (title may have changed)
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready") {
      onTitleMayHaveChanged();
    }
    prevStatus.current = status;
  }, [status, onTitleMayHaveChanged]);

  const busy = status === "submitted" || status === "streaming";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-border/70 bg-background/60 px-4 py-2 backdrop-blur-sm sm:px-8">
        <IntensiveCheckoutButton threadId={threadId} />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto w-full max-w-[760px] space-y-6">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
              <MessageCircle className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 font-display text-[20px]">
                What's stuck?
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Bring one issue. I'll give you the read and a next move.
              </p>
              <p
                className="mx-auto mt-5 max-w-[460px] text-[12px] leading-relaxed text-foreground/85"
                style={{
                  fontFamily: "var(--font-serif)",
                  textShadow:
                    "0 1px 0 color-mix(in oklab, var(--ink) 8%, transparent)",
                }}
              >
                You're talking to me. This is trained on my own playbooks,
                SOPs, field notes, and lessons from $2.5B in construction.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} threadId={threadId} />
          ))}
          {busy && <ProcessingSteps messages={messages} status={status} />}
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive">
              {String(error.message || error)}
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={submit}
        className="border-t border-border bg-background px-4 py-4 sm:px-8"
      >
        <div className="mx-auto flex w-full max-w-[760px] items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-foreground/30">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask Marshall anything…"
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-ink outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-cream transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message, threadId }: { message: UIMessage; threadId: string }) {
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  const isUser = message.role === "user";
  const mentionsIntensive =
    !isUser && /6[-\s]?week intensive/i.test(text);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink px-4 py-3 text-[14px] leading-relaxed text-cream">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-start">
      <div className="mb-2 flex items-center gap-2 text-foreground/80">
        <Megaphone className="h-4 w-4" />
        <span
          className="text-[15px] italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Marshall
        </span>
      </div>
      <div
        className="w-full max-w-[680px] text-[17px] leading-[1.65] text-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        <div className="prose-marshall">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="mb-3 last:mb-0 leading-[1.7]">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => (
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-[1.7]">{children}</li>,
              h1: ({ children }) => (
                <h3 className="mb-2 mt-4 text-[18px] font-semibold first:mt-0">{children}</h3>
              ),
              h2: ({ children }) => (
                <h3 className="mb-2 mt-4 text-[17px] font-semibold first:mt-0">{children}</h3>
              ),
              h3: ({ children }) => (
                <h4 className="mb-2 mt-3 text-[16px] font-semibold first:mt-0">{children}</h4>
              ),
              code: ({ children }) => (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{children}</code>
              ),
              pre: ({ children }) => (
                <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[12.5px] last:mb-0">{children}</pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="mb-3 border-l-2 border-signal/40 pl-3 italic text-foreground/85 last:mb-0">{children}</blockquote>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer" className="text-signal underline underline-offset-2">{children}</a>
              ),
              hr: () => <hr className="my-4 border-border" />,
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Copy response"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {mentionsIntensive && (
        <IntensiveInterestCTA threadId={threadId} />
      )}
    </div>
  );
}
function IntensiveInterestCTA({ threadId }: { threadId: string }) {
  const expressFn = useServerFn(expressIntensiveInterest);
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  if (state === "done") {
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
        <Check className="h-3.5 w-3.5" />
        Got it — Marshall's team will reach out about the intensive.
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={state === "saving"}
      onClick={async () => {
        setState("saving");
        try {
          await expressFn({ data: { threadId } });
          setState("done");
        } catch {
          setState("error");
        }
      }}
      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-ink/20 bg-ink px-3 py-2 text-[12px] font-medium text-cream transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {state === "saving"
        ? "Saving…"
        : state === "error"
          ? "Try again"
          : "I'm interested in the 6-week intensive"}
    </button>
  );
}

/**
 * Manus-style "the agent is working" indicator.
 *
 * Shows a live list of steps while waiting for / receiving the first tokens.
 * The last user message is read so the steps feel grounded in what was asked.
 * Steps advance on a timer; the final step flips to "complete" once Marshall
 * actually starts streaming text.
 */
function ProcessingSteps({
  messages,
  status,
}: {
  messages: UIMessage[];
  status: string;
}) {
  // Hide as soon as assistant has produced any text — the message bubble takes over.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const assistantText =
    lastAssistant?.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim() ?? "";
  if (status === "streaming" && assistantText.length > 0) return null;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText =
    lastUser?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
  const preview = userText.length > 80 ? userText.slice(0, 78) + "…" : userText;

  const steps = [
    { icon: BookOpen, label: "Reading your message", detail: preview || "Parsing the question" },
    { icon: Brain, label: "Pulling from playbooks", detail: "SOPs, field notes, $2.5B in lessons" },
    { icon: Wand2, label: "Composing the read", detail: "Marshall's voice, your situation" },
  ];

  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setActive((i) => Math.min(i + 1, steps.length - 1));
    }, 1100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="group flex flex-col items-start">
      <div className="mb-2 flex items-center gap-2 text-foreground/80">
        <Megaphone className="h-4 w-4" />
        <span
          className="text-[15px] italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Marshall
        </span>
        <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
          <span className="thinking-dot inline-block h-1 w-1 rounded-full bg-current" />
          <span className="thinking-dot inline-block h-1 w-1 rounded-full bg-current" />
          <span className="thinking-dot inline-block h-1 w-1 rounded-full bg-current" />
        </span>
      </div>

      <ul className="w-full max-w-[680px] space-y-2 rounded-2xl border border-border bg-card/60 p-4">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const done = i < active;
          const running = i === active;
          return (
            <li key={s.label} className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  done
                    ? "bg-signal-success/15 text-signal-success"
                    : running
                      ? "bg-signal/15 text-signal animate-step-pulse"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] ${
                    done
                      ? "text-muted-foreground line-through decoration-muted-foreground/40"
                      : running
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </p>
                {(done || running) && s.detail && (
                  <p className="truncate text-[11px] text-muted-foreground">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IntensiveCheckoutButton({ threadId }: { threadId: string }) {
  const checkoutFn = useServerFn(createIntensiveCheckout);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setErr(null);
    try {
      const { url } = await checkoutFn({ data: { source: "ask_marshall", threadId } });
      window.location.assign(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start checkout.");
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gold bg-gold-soft px-3 py-1.5 text-[12px] text-ink hover:bg-gold/30"
        title="Six-Week Intensive — six private sessions with Marshall"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Six-Week Intensive
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-[320px] rounded-xl border border-border bg-background p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-display text-[15px] tracking-tight">Six-Week Intensive</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Six private sessions with Marshall to pressure-test and install the next move.
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-2xl">$5,000</span>
            <span className="text-[11px] text-muted-foreground">one-time · six weeks</span>
          </div>
          <button
            onClick={start}
            disabled={loading}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Opening checkout…" : "Enroll · $5,000"}
          </button>
          {err && <p className="mt-2 text-[12px] text-destructive">{err}</p>}
          <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
            Secure checkout via Stripe. Marshall will reach out within one business day.
          </p>
        </div>
      )}
    </div>
  );
}
