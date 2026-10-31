import { describe, expect, it } from "vitest";
import { WhichCompanyAsk, resolveJob } from "./jobs";
import { soleJob } from "./tools/workflow-tools";

const ALP = { id: "alp", name: "ALP Construction" };
const AOP = { id: "aop", name: "AOP Construction" };

function db(jobs: Record<string, { id: string; job_number: string; name: string }[]>) {
  return {
    from(table: string) {
      if (table === "mcp_companies") return { select: async () => ({ data: [ALP, AOP], error: null }) };
      if (table === "mcp_user_settings") {
        return { select: () => ({ maybeSingle: async () => ({ data: { current_company: ALP.id }, error: null }) }) };
      }
      return { select: async () => ({ data: [], error: null }) };
    },
    rpc: async (fn: string, args: { _company: string; _job_number: string }) => {
      if (fn !== "mcp_resolve_job") return { data: null, error: null };
      const hit = (jobs[args._company] ?? []).find((job) => job.job_number === args._job_number);
      if (!hit) return { data: { not_found: true, suggestions: [] }, error: null };
      return { data: { job_id: hit.id, job_number: hit.job_number, name: hit.name, company_id: args._company, scope: "full" }, error: null };
    },
  } as never;
}

function listed(jobs: Record<string, { id: string; job_number: string; name: string; company_id: string; updated_at: string | null }[]>, current: string | null) {
  const companies = [ALP, AOP];
  const rows = Object.values(jobs).flat();
  return {
    from(table: string) {
      if (table === "mcp_companies") return { select: async () => ({ data: companies, error: null }) };
      if (table === "mcp_user_settings") return { select: () => ({ maybeSingle: async () => ({ data: { current_company: current }, error: null }) }) };
      if (table === "mcp_jobs") return { select: () => ({ in: async (_col: string, ids: string[]) => ({ data: rows.filter((row) => ids.includes(row.company_id)), error: null }) }) };
      return { select: async () => ({ data: [], error: null }) };
    },
  } as never;
}

describe("a unique job number resolves across companies", () => {
  const jobs = {
    aop: [{ id: "job-2701", job_number: "2701", name: "Harbor Point" }],
    alp: [{ id: "job-1234", job_number: "1234", name: "Riverside" }],
  };

  it("finds 2701 when the active company is ALP and no company was named", async () => {
    const job = await resolveJob(db(jobs), "2701");
    expect(job.job_id).toBe("job-2701");
    expect(job.company_id).toBe("aop");
  });

  it("stops when an explicit company does not contain the job", async () => {
    await expect(resolveJob(db(jobs), "2701", "alp")).rejects.toThrow("not in the company you named");
  });

  it("keeps the named company when that company has the job", async () => {
    const job = await resolveJob(db(jobs), "1234", "ALP Construction");
    expect(job.company_id).toBe("alp");
    expect(job.job_number).toBe("1234");
  });

  it("uses the only job when none was named, including one that sits outside the active company", async () => {
    const only = await soleJob(listed({
      aop: [{ id: "job-2701", job_number: "2701", name: "Harbor Point", company_id: "aop", updated_at: null }],
    }, ALP.id));
    expect(only?.job_number).toBe("2701");
    expect(only?.company_id).toBe("aop");
  });

  it("uses the only job in the active company when another company also has a job", async () => {
    const picked = await soleJob(listed({
      aop: [{ id: "job-2701", job_number: "2701", name: "Harbor Point", company_id: "aop", updated_at: null }],
      alp: [{ id: "job-1234", job_number: "1234", name: "Riverside", company_id: "alp", updated_at: null }],
    }, ALP.id));
    expect(picked?.job_number).toBe("1234");
  });

  it("asks which company when the same number is on two companies", async () => {
    const both = {
      alp: [{ id: "a", job_number: "2701", name: "Harbor ALP" }],
      aop: [{ id: "b", job_number: "2701", name: "Harbor AOP" }],
    };
    await expect(resolveJob(db(both), "2701")).rejects.toBeInstanceOf(WhichCompanyAsk);
  });
});
