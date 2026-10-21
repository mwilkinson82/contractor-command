import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dbError } from "./guard";

const MIG = readFileSync("supabase/migrations/20261021200000_athena_member_add_seat_cap.sql", "utf8");
const body = MIG.slice(MIG.indexOf("FUNCTION public.mcp_member_add("));

describe("0.8.16.2 add_member respects the seat cap", () => {
  it("checks the cap (members + pending) under the same lock as team_invite, only for new people", () => {
    expect(body).toMatch(/IF b IS NULL THEN[\s\S]*pg_advisory_xact_lock\(hashtext\('mcp_team_seats:'/);
    expect(body).toMatch(/used := \(u->>'members'\)::int \+ \(u->>'pending'\)::int/);
    expect(body).toMatch(/RAISE EXCEPTION 'MCP_SEAT_LIMIT:%:%', used, lim/);
    expect(body.indexOf("MCP_SEAT_LIMIT")).toBeLessThan(body.indexOf("INSERT INTO public.mcp_company_members"));
  });
  it("keeps owner-only and plan role gating, logs before/after, removes nobody", () => {
    expect(body).toMatch(/Only a company Owner can add members/);
    expect(body).toMatch(/mcp_role_allowed\(_company, _role\)/);
    expect(body).toMatch(/mcp_team_log\(_company, uid,/);
    expect(MIG).not.toMatch(/DELETE FROM/);
  });
  it("the seat-limit error reaches the member as the plain seat message", () => {
    expect(() => dbError({ message: "MCP_SEAT_LIMIT:9:6" })).toThrow(/seat limit \(9 of 6/);
  });
});
