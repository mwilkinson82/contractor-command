import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { defineMcp } from "@lovable.dev/mcp-js";
import * as W from "./tools/workflow-tools";
import * as L from "./tools/living-tools";
import * as F from "./tools/file-tools";
import * as R from "./tools/report-page-tools";
import * as T from "./tools/team-tools";
import * as E from "./tools/email-tools";
import * as G from "./tools/flow-tools";
import * as Est from "./tools/estimate-tools";
import * as Bid from "./tools/estimate-bid-tools";
import * as Field from "./tools/superintendent-tools";
import * as Start from "./tools/getting-started-tool";
import * as Brief from "./tools/morning-brief-tools";
import * as Sub from "./tools/submittal-tools";
import * as Chase from "./tools/submittal-chase-tool";
import { ATHENA_VERSION } from "./server-info-branding";

type Prop = { format?: string; pattern?: string; description?: string };
type Tool = {
  name: string;
  description?: string;
  inputSchema: { properties: Record<string, Prop> };
};

// One source of truth: the committed .lovable/mcp/manifest.json must match what the source publishes.
// Regenerate with: npx lovable-mcp-extract-manifest .
const manifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8")) as {
  mcp: { server: { version: string }; tools: Tool[] };
};

async function liveTools(): Promise<Tool[]> {
  const m = defineMcp({
    name: "athena",
    title: "A",
    version: "t",
    instructions: "i",
    tools: [
      W.onboarding,
      W.intake,
      W.nextQuestion,
      W.answer,
      W.report,
      W.contractTerms,
      W.carryForward,
      W.listOpenItems,
      W.lookaheadList,
      W.resolveItem,
      L.cpmActivities,
      L.livingReportGet,
      L.livingReportSave,
      F.fileShare,
      F.fileShareRevoke,
      F.lookaheadPdfTool,
      R.reportPageLink,
      R.reportPageShare,
      R.reportPageShareRevoke,
      T.teamList,
      T.teamInvite,
      T.teamUpdateMember,
      T.teamRemoveMember,
      T.teamAddSeats,
      T.setCurrentCompany,
      Est.estimateIntake,
      Est.estimateDocReview,
      Est.estimateTakeoffSave,
      Est.estimateTakeoffGet,
      Est.estimateTakeoffExport,
      Est.estimateGapAnalysis,
      Est.estimateBidCheck,
      Est.estimateItemMark,
      Est.estimateBuild,
      Est.estimateStatus,
      Bid.estimatePricing,
      Bid.estimateRateSources,
      Bid.estimateGeneralConditions,
      Bid.estimateRequirements,
      Bid.estimateBidSummary,
      Field.superintendentView,
      Field.fieldBoard,
      Field.superintendentActivity,
      Field.dailyReportDraft,
      Field.dailyReportSave,
      Field.dailyReportGet,
      Field.fieldPayApp,
      Field.fieldScheduleFeed,
      Field.fieldProductionRates,
      Field.progressPhotoSave,
      Field.progressPhotos,
      Field.dailyReminder,
      Field.dailyReminderRun,
      G.pmMeeting,
      G.pmMorning,
      G.pmMorningMeeting,
      G.pmEvening,
      Brief.athenaHello,
      Brief.morningBrief,
      Brief.morningBriefSettings,
      E.emailDraft,
      E.emailConfirmSend,
      Sub.submittalLog,
      Sub.submittalsList,
      Sub.submittalsImport,
      Sub.projectRecordSearch,
      Chase.submittalChase,
      Start.gettingStarted,
    ],
    metrics: false,
  } as never);
  const h = createTanStackMcpHandler(m, { resourcePath: "/mcp" });
  const post = (b: unknown) =>
    h({
      request: new Request("https://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(b),
      }),
    });
  await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  const t = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
  const json = JSON.parse(
    t.trimStart().startsWith("{")
      ? t
      : t
          .split("\n")
          .find((l) => l.startsWith("data:"))!
          .slice(5),
  );
  return json.result.tools;
}

const isLookahead = (k: string) => /lookahead_id$/.test(k);

describe("MCP manifest is in sync with source", () => {
  it("manifest version matches ATHENA_VERSION", () =>
    expect(manifest.mcp.server.version).toBe(ATHENA_VERSION));

  it("no lookahead field in the manifest carries a uuid format or pattern, and each mentions LA- refs", () => {
    let n = 0;
    for (const t of manifest.mcp.tools)
      for (const [k, p] of Object.entries(t.inputSchema.properties ?? {}))
        if (isLookahead(k)) {
          n++;
          expect(p.format, `${t.name}.${k}`).toBeUndefined();
          expect(p.pattern, `${t.name}.${k}`).toBeUndefined();
          expect(p.description, `${t.name}.${k}`).toBeUndefined();
        }
    expect(n).toBe(7);
  });

  it("manifest tool schemas equal the source tools/list", async () => {
    const live = await liveTools();
    const byName = (ts: Tool[]) => Object.fromEntries(ts.map((t) => [t.name, t.inputSchema]));
    expect(Object.keys(byName(manifest.mcp.tools)).sort()).toEqual(
      Object.keys(byName(live)).sort(),
    );
    const lv = byName(live);
    for (const t of manifest.mcp.tools) expect(t.inputSchema, t.name).toEqual(lv[t.name]);
  });
});
