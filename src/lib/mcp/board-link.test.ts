import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardLinkExpiry, boardLinkStatus, boardPageAllowed, withBoardToken, type BoardLinkRow } from "./board-link";

const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-22T12:00:00Z");

function row(over: Partial<BoardLinkRow> = {}): BoardLinkRow {
  return {
    job_id: JOB,
    scope: "full",
    expires_at: "2026-10-23T12:00:00Z",
    revoked_at: null,
    ...over,
  };
}

describe("board link token", () => {
  it("lasts about 24 hours and stays on one job's page", () => {
    const exp = boardLinkExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(withBoardToken(`https://app.meetathena.io/r/job/${JOB}/items`, "abc")).toBe(
      `https://app.meetathena.io/r/job/${JOB}/items?t=abc`,
    );
    expect(boardPageAllowed("payapp", "super")).toBe(false);
    expect(boardPageAllowed("field", "super")).toBe(true);
  });

  it("refuses an expired token", () => {
    expect(boardLinkStatus(row({ expires_at: "2026-10-22T11:00:00Z" }), JOB, "items", now)).toBe("expired");
  });

  it("refuses a revoked token", () => {
    expect(boardLinkStatus(row({ revoked_at: "2026-10-22T11:00:00Z" }), JOB, "field", now)).toBe("revoked");
  });

  it("refuses the wrong job and does not treat it as this job", () => {
    expect(boardLinkStatus(row({ job_id: OTHER }), JOB, "items", now)).toBe("wrong_job");
  });

  it("accepts a live token for this job and denies a page the role cannot see", () => {
    expect(boardLinkStatus(row(), JOB, "items", now)).toBe("ok");
    expect(boardLinkStatus(row({ scope: "super" }), JOB, "payapp", now)).toBe("denied");
    expect(boardLinkStatus(null, JOB, "items", now)).toBe("unknown");
  });

  it("stores only the hash and returns no other job before an expired, revoked, or wrong-job token is refused", () => {
    const sql = readFileSync("supabase/migrations/20261023070000_athena_board_links.sql", "utf8");
    expect(sql).toContain("token_hash text NOT NULL UNIQUE");
    expect(sql).not.toMatch(/\btoken text\b/);
    const open = sql.slice(sql.indexOf("FUNCTION public.mcp_board_link_open"));
    for (const status of ["wrong_job", "revoked", "expired"]) {
      expect(open).toContain(`'${status}'`);
      expect(open.indexOf(`'${status}'`)).toBeLessThan(open.indexOf("mcp_report_page_get"));
    }
    expect(open).toContain("jsonb_build_object('status', 'wrong_job')");
    expect(open).not.toContain("jsonb_build_object('status', 'wrong_job', 'payload'");
  });
});
