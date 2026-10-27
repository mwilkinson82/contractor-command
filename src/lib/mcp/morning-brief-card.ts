// In-app morning card. The first reply after the member's briefing time, or morning_brief
// itself, shows the same role-aware card as the push. Once per local day. No email.
import { htmlBlock, renderMarkdown } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import { parseSendTime } from "./field-reminder";
import type { Sb } from "./guard";
import { briefSettingsFrom, buildMorningBrief, MORNING_BRIEF_DEFAULT_TIME, MORNING_CARD_GUIDANCE, type BriefSettings } from "./morning-brief";
import { loadBriefJobs, readBriefSettings } from "./morning-brief-load";

export type MorningCardStatus = {
  enabled?: boolean;
  send_local?: string;
  time_zone?: string;
  local_date?: string;
  local_minutes?: number;
  already_shown?: boolean;
};

type Rpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

type TextBlock = { type: string; text?: string };
type TextRes = { content?: TextBlock[]; structuredContent?: Record<string, unknown> };

/** Due once local minutes are at or after the briefing time, and the card has not been shown that local day. */
export function morningCardIsDue(row: MorningCardStatus): boolean {
  if (row.enabled === false || row.already_shown === true) return false;
  if (!row.local_date) return false;
  const send = parseSendTime((row.send_local || MORNING_BRIEF_DEFAULT_TIME).slice(0, 5));
  if (send == null) return false;
  return Number(row.local_minutes ?? -1) >= send;
}

async function cardStatus(sb: Rpc): Promise<MorningCardStatus | null> {
  const { data, error } = await sb.rpc("mcp_morning_brief_card_status");
  if (error || !data || typeof data !== "object") return null;
  const row = data as MorningCardStatus;
  if (!row.local_date) return null;
  return row;
}

function withMorningGuidance<R>(result: R): R {
  const res = result as unknown as TextRes;
  const prior = Array.isArray(res.structuredContent?.assistant_guidance)
    ? (res.structuredContent.assistant_guidance as string[])
    : [];
  const guidance = prior.filter((line) => line !== MORNING_CARD_GUIDANCE);
  guidance.push(MORNING_CARD_GUIDANCE);
  return { ...(res as object), structuredContent: { ...(res.structuredContent ?? {}), assistant_guidance: guidance } } as R;
}

async function markShown(sb: Rpc, day: string): Promise<boolean> {
  const marked = await sb.rpc("mcp_morning_brief_mark_shown", { _day: day });
  return !marked.error && !!marked.data && typeof marked.data === "object" && (marked.data as { recorded?: boolean }).recorded === true;
}

/**
 * Shows the morning card once per local day.
 * A fresh session prepends it onto the first reply. morning_brief is already that card,
 * so it only records the day and does not add a second copy.
 */
export async function attachMorningCard<R>(sb: Rpc, result: R, opts: { fresh: boolean; explicit: boolean }): Promise<R> {
  if (!opts.fresh && !opts.explicit) return result;
  const res = result as unknown as TextRes;
  // Explicit entry guidance stays first, even when a proactive briefing is due.
  // Do not mark the briefing shown: it remains available on a later eligible reply.
  if (!opts.explicit && (res.structuredContent?.card as { presentation?: string } | undefined)?.presentation === "onboarding") return result;
  const first = res?.content?.find((block) => block.type === "text" && typeof block.text === "string");
  if (!first?.text) return result;
  if (res.structuredContent && "morning_card" in res.structuredContent) return result;
  let status: MorningCardStatus | null;
  try {
    status = await cardStatus(sb);
  } catch {
    return result;
  }
  if (!status || !morningCardIsDue(status)) return opts.explicit ? withMorningGuidance(result) : result;
  if (opts.explicit) {
    if (status?.local_date) {
      try {
        await markShown(sb, status.local_date);
      } catch {
        // The tool card is still the reply.
      }
    }
    return withMorningGuidance(result);
  }
  let built: ReturnType<typeof buildMorningBrief>;
  try {
    const loaded = await loadBriefJobs(sb as Sb);
    let settings: BriefSettings | undefined;
    try {
      settings = briefSettingsFrom(await readBriefSettings(sb as Sb));
    } catch {
      settings = undefined;
    }
    built = buildMorningBrief({ jobs: loaded.jobs, hasCompany: loaded.hasCompany, settings });
  } catch {
    return result;
  }
  let recorded = false;
  try {
    recorded = await markShown(sb, status.local_date!);
  } catch {
    return result;
  }
  if (!recorded) return result;
  const block = `${renderMarkdown(built.card)}\n\n${htmlBlock(renderHtml(built.card))}`;
  const content = res.content!.map((blockItem) => (blockItem === first ? { ...blockItem, text: `${block}\n\n${first.text}` } : blockItem));
  return withMorningGuidance({
    ...(res as object),
    content,
    structuredContent: { ...(res.structuredContent ?? {}), morning_card: built.card },
  } as R);
}
