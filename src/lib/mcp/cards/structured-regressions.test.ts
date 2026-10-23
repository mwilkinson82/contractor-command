// Local review reproductions only; no backend access or persisted job data.
import { describe, expect, it, vi } from "vitest";
vi.mock("../guard", async () => ({
  run: async (
    _tool: string,
    _ctx: unknown,
    _opts: unknown,
    fn: (sb: unknown) => Promise<unknown>,
  ) => fn(sb),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
}));
vi.mock("../jobs", async (original) => ({
  ...(await original<typeof import("../jobs")>()),
  resolveJob: async () => ({
    job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    job_number: "2701",
    name: "Fictional review job",
    scope: "contract",
  }),
  audit: async () => {},
}));
import { contractTerms } from "../tools/workflow-tools";
import { attachAthenaCard } from "./attach";
import { renderHtml } from "./html";
import { clauseSection, sovCard } from "./structured";
import type { ClauseRow } from "../contract-clauses";
import type { CardModel } from "./model";

type ContractResult = {
  content: { type: string; text: string }[];
  structuredContent: { card?: CardModel; clauses: { value: string | null }[] };
};
// Exercise the real handler without the transport; the local guard/job mocks supply its context.
const readContract = (include_summary: boolean) =>
  (
    contractTerms.handler as unknown as (
      args: { job_number: string; include_summary: boolean },
      ctx: unknown,
    ) => Promise<ContractResult>
  )({ job_number: "2701", include_summary }, {});
const source: ClauseRow = {
  section: "6.2",
  heading: "Delay Notice",
  category: "delay_notice",
  source: "document",
  verbatim_text: "Notify the Contractor within ____ days at address ____.",
  n_days: null,
  day_type: null,
  trigger_desc: null,
};
const sb = {
  from(table: string) {
    let module = "";
    const q = {
      select: () => q,
      eq(key: string, value: string) {
        if (key === "module") module = value;
        return q;
      },
      in: () => q,
      maybeSingle: () => q,
      then(resolve: (r: unknown) => unknown) {
        const data =
          table === "mcp_contract_clauses"
            ? [source]
            : table === "mcp_job_flags"
              ? []
              : table === "mcp_jobs"
                ? {}
                : table === "mcp_job_facts" && module === "contract"
                  ? [
                      {
                        key: "pay_terms",
                        value: "UNIQUE REQUESTED SUMMARY: payment within 30 days.",
                        status: "known",
                        source: "document",
                      },
                    ]
                  : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  },
  rpc: async () => ({ data: {}, error: null }),
};
describe("structured card regressions", () => {
  it("preserves underscore blanks in exact quoted contract text", () => {
    const quote = clauseSection(source).rows.find((r) => r.tone === "quote")!.cells[0];
    expect(quote).toBe(source.verbatim_text);
  });
  it("includes contractor fee in the division view before the contract total", () => {
    const card = sovCard({
      job: "2701 fictional",
      rows: [
        {
          item_no: "26.01",
          cost_code: null,
          division: "26",
          division_title: "Electrical",
          description: "Fictional work",
          scheduled_value_display: "$900.00",
          pct_of_total: 90,
        },
      ],
      divisions: [
        {
          division: "26",
          title: "Electrical",
          scheduled_value_display: "$900.00",
          pct_of_contract: 90,
        },
      ],
      fee: { display: "$100.00", pct: 10 },
      totalDisplay: "$1,000.00",
      basis: null,
      audience: "internal",
      view: "divisions",
    });
    expect(
      card.sections![0].rows.some(
        (row) => row.cells.includes("Contractor's fee") && row.cells.includes("$100.00"),
      ),
    ).toBe(true);
  });
  it("retains the explicitly requested summary in displayed contract output", async () => {
    const raw = await readContract(true);
    expect(
      raw.structuredContent.clauses.some((c) => c.value?.includes("UNIQUE REQUESTED SUMMARY")),
    ).toBe(true);
    const displayed = attachAthenaCard("contract_terms", raw);
    expect({
      cardContainsSummary: renderHtml(displayed.structuredContent.card!).includes(
        "UNIQUE REQUESTED SUMMARY",
      ),
      replyContainsSummary: displayed.content[0].text.includes("UNIQUE REQUESTED SUMMARY"),
    }).toEqual({ cardContainsSummary: true, replyContainsSummary: true });
  });
  it("does not show a summary until requested and retains the summary offer", async () => {
    const raw = await readContract(false);
    const displayed = attachAthenaCard("contract_terms", raw);
    expect(renderHtml(displayed.structuredContent.card!)).not.toContain("UNIQUE REQUESTED SUMMARY");
    expect(displayed.content[0].text).not.toContain("UNIQUE REQUESTED SUMMARY");
    expect(displayed.structuredContent.card?.ask?.prompt).toContain("Do you want me to summarize");
    expect(source.verbatim_text).toBe("Notify the Contractor within ____ days at address ____.");
  });
});
