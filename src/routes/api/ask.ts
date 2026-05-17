import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import {
  convertToModelMessages,
  streamText,
  generateText,
  type UIMessage,
} from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { buildMarshallSystemPrompt } from "@/lib/marshall-prompt";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";

type Body = { messages?: UIMessage[]; threadId?: string };

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
          .select("id,user_id,title")
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

        const result = streamText({
          model,
          system: buildMarshallSystemPrompt(),
          messages: await convertToModelMessages(messages),
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
                    model,
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
