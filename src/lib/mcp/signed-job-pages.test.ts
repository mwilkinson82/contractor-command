import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { signedJobPages } from "./board-url";

const JOB = "11111111-1111-4111-8111-111111111111";
const workflow = readFileSync(new URL("./tools/workflow-tools.ts", import.meta.url), "utf8");
const boardUrl = readFileSync(new URL("./board-url.ts", import.meta.url), "utf8");

function contractTermsSource(): string {
  const start = workflow.indexOf('name: "contract_terms"');
  const end = workflow.indexOf("// ---------- SOV", start);
  return workflow.slice(start, end);
}

describe("superintendent signed board links", () => {
  it("keeps super on the contract_terms signedJobPages call", () => {
    const body = contractTermsSource();
    expect(body).toContain('job.scope === "full" || job.scope === "super" ? await signedJobPages(');
    expect(body).not.toContain('const board = job.scope === "full" ? await signedJobPages(');
  });

  it("signedJobPages still treats super as a signed-link scope", () => {
    const fn = boardUrl.slice(
      boardUrl.indexOf("export async function signedJobPages"),
      boardUrl.indexOf("export { submittalRecordUrl"),
    );
    expect(fn).toContain('scope !== "full" && scope !== "super"');
  });

  it("mints field and schedule links for super and skips contract-only scope", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "link-1" }, error: null }));
    const pages = await signedJobPages(rpc, JOB, "super");
    expect(pages.field).toContain(`/r/job/${JOB}/field?t=`);
    expect(pages.schedule).toContain(`/r/job/${JOB}/schedule?t=`);
    expect(pages.items).toContain(`/r/job/${JOB}/items?t=`);
    expect(pages.ior).toBeUndefined();
    expect(pages.payapp).toBeUndefined();
    expect(rpc).toHaveBeenCalledOnce();

    const skipped = vi.fn(async () => ({ data: { id: "link-2" }, error: null }));
    expect(await signedJobPages(skipped, JOB, "contract")).toEqual({});
    expect(skipped).not.toHaveBeenCalled();
  });
});
