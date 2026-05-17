import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import {
  streamText,
  generateText,
  type ModelMessage,
  type UIMessage,
} from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { buildMarshallSystemPrompt } from "@/lib/marshall-prompt";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";

type Body = { messages?: UIMessage[]; threadId?: string };

// Summarization tuning.
const RECENT_WINDOW = 6; // last N messages always sent verbatim
const SUMMARIZE_THRESHOLD = 12; // total msgs before summarization kicks in
const RESUMMARIZE_EVERY = 6; // re-summarize every N new older messages

async function getUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function extractText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/ask")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserId(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const { messages, threadId } = (await request.json()) as Body;
        if (!Array.isArray(messages) || !threadId) {
          return new Response("Bad request", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        // Verify thread ownership (admin client; RLS bypass for service work).
        const { data: thread } = await supabaseAdmin
          .from("ask_threads")
          .select("id,user_id,title,summary,summary_message_count")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread || thread.user_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        // Daily message cap (per-user, UTC day). Keeps cost predictable.
        const DAILY_USER_MESSAGE_CAP = 30;
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const { count: todayCount } = await supabaseAdmin
          .from("ask_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("role", "user")
          .gte("created_at", startOfDay.toISOString());
        if ((todayCount ?? 0) >= DAILY_USER_MESSAGE_CAP) {
          return new Response(
            `You've hit today's limit of ${DAILY_USER_MESSAGE_CAP} messages with Marshall. Come back tomorrow — or upgrade for more.`,
            { status: 429 },
          );
        }

        // Persist the newest user message (last in array).
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const lastUserText = lastUser ? extractText(lastUser) : "";
        if (lastUserText) {
          await supabaseAdmin.from("ask_messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            content: lastUserText,
          });
        }

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");
        // Cheap model for non-user-facing utility calls (titles, summaries).
        const utilityModel = gateway("google/gemini-3.1-flash-lite-preview");

        // Rebuild history from DB so we control token cost (don't trust client).
        const { data: allRows } = await supabaseAdmin
          .from("ask_messages")
          .select("id,role,content,created_at")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: true });
        const history = (allRows ?? []).filter(
          (r) => r.role === "user" || r.role === "assistant",
        );

        // Rolling summary: if thread is long, summarize all-but-last-RECENT_WINDOW
        // messages and only re-summarize every RESUMMARIZE_EVERY new older msgs.
        let summary = thread.summary ?? null;
        let summaryCount = thread.summary_message_count ?? 0;
        const olderCount = Math.max(0, history.length - RECENT_WINDOW);
        const shouldSummarize =
          history.length > SUMMARIZE_THRESHOLD &&
          olderCount - summaryCount >= (summary ? RESUMMARIZE_EVERY : 1);

        if (shouldSummarize) {
          const olderMessages = history.slice(0, olderCount);
          const transcript = olderMessages
            .map(
              (m) =>
                `${m.role === "user" ? "Owner" : "Marshall"}: ${m.content}`,
            )
            .join("\n\n");
          try {
            const sumRes = await generateText({
              model: utilityModel,
              prompt: `Summarize this construction-business coaching conversation between an owner and Marshall. Capture: the owner's situation, decisions reached, open questions, and any commitments. Tight bullet points, no preamble, under 200 words.\n\n${transcript.slice(0, 12000)}`,
            });
            summary = sumRes.text.trim();
            summaryCount = olderCount;
            await supabaseAdmin
              .from("ask_threads")
              .update({
                summary,
                summary_message_count: summaryCount,
              })
              .eq("id", threadId);
          } catch (e) {
            console.error("summarization failed", e);
          }
        }

        // Build model messages: summary (if any) + last RECENT_WINDOW msgs.
        const recentStart = summary
          ? Math.max(summaryCount, history.length - RECENT_WINDOW)
          : 0;
        const recent = history.slice(recentStart);
        const modelMessages: ModelMessage[] = [];
        if (summary) {
          modelMessages.push({
            role: "system",
            content: `Earlier in this conversation (summary):\n${summary}`,
          });
        }
        for (const m of recent) {
          modelMessages.push({
            role: m.role as "user" | "assistant",
            content: m.content,
          });
        }

        const result = streamText({
          model,
          system: buildMarshallSystemPrompt(),
          messages: modelMessages,
          onFinish: async ({ text }) => {
            try {
              await supabaseAdmin.from("ask_messages").insert({
                thread_id: threadId,
                user_id: userId,
                role: "assistant",
                content: text,
              });
              await supabaseAdmin
                .from("ask_threads")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", threadId);

              // Auto-title if still default.
              if (
                thread.title === "New conversation" &&
                lastUserText.length > 0
              ) {
                try {
                  const titleRes = await generateText({
                    model: utilityModel,
                    prompt: `Summarize this construction-business question as a 3–6 word title, no quotes, no punctuation at the end. Question: "${lastUserText.slice(0, 400)}"`,
                  });
                  const title = titleRes.text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
                  if (title) {
                    await supabaseAdmin
                      .from("ask_threads")
                      .update({ title })
                      .eq("id", threadId);
                  }
                } catch (e) {
                  console.error("auto-title failed", e);
                }
              }
            } catch (e) {
              console.error("persist assistant failed", e);
            }
          },
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});
