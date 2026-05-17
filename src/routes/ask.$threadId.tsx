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
import { ArrowUp, Plus, Trash2, MessageCircle, Check, Sparkles } from "lucide-react";

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
    <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[260px_1fr]">
      {/* Thread sidebar */}
      <aside className="hidden border-r border-border bg-card/40 md:flex md:flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Conversations
          </p>
          <Link
            to="/ask"
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
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
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
              <p className="mx-auto mt-4 max-w-[440px] text-[11px] leading-relaxed text-muted-foreground">
                Trained on Marshall's own playbooks, SOPs, and field notes from
                $2.5B in built work. You're talking to him.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} threadId={threadId} />
          ))}
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
        <div className="mx-auto flex w-full max-w-[760px] items-end gap-2 rounded-2xl border border-border bg-card p-2 focus-within:border-foreground/30">
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
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-cream transition-opacity disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
          isUser
            ? "bg-ink text-cream"
            : "border border-border bg-card text-foreground"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
