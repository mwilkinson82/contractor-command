import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ filters: [] as unknown[][] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push([table, "eq", column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          state.filters.push([table, "is", column, value]);
          return builder;
        },
        gt: (column: string, value: unknown) => {
          state.filters.push([table, "gt", column, value]);
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === "mcp_submittal_packages"
              ? {
                  id: "11111111-1111-4111-8111-111111111111",
                  submittal_id: "22222222-2222-4222-8222-222222222222",
                  job_id: "33333333-3333-4333-8333-333333333333",
                  company_id: "fictional-company",
                }
              : { number: "05 12 00-001" },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));
import { openSubmittalFile, type DraftRecord } from "./submittal-file-route.server";
import { newToken, tokenHash } from "./mcp/file-share";

const record: DraftRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  submittal_id: "22222222-2222-4222-8222-222222222222",
  job_id: "33333333-3333-4333-8333-333333333333",
  number: "05 12 00-001",
};
afterEach(() => vi.unstubAllEnvs());
describe("unsent submittal file links", () => {
  it.each(["GET", "HEAD"] as const)(
    "%s routes a valid draft to the existing member-only record without granting file access",
    async (method) => {
      const token = newToken(),
        resolve = vi.fn(async () => record);
      const response = await openSubmittalFile(
        token,
        method,
        async () => new Response(null, { status: 410 }),
        resolve,
      );
      expect(resolve).toHaveBeenCalledWith(await tokenHash(token));
      expect(response.status).toBe(302);
      const target = new URL(response.headers.get("location")!, "https://app.meetathena.io");
      expect(target.pathname).toBe(`/r/job/${record.job_id}/submittal/05%2012%2000-001`);
      expect(target.searchParams.get("package_id")).toBe(record.id);
      expect(target.searchParams.get("open")).toBe("package");
      expect(target.searchParams.has("t")).toBe(false);
      expect([...response.headers].join()).not.toContain(token);
      expect(await response.text()).toBe("");
    },
  );
  it("preserves approved recipient downloads and never attempts draft lookup for them", async () => {
    const resolve = vi.fn(),
      approved = new Response("%PDF-approved", { status: 200 });
    expect(await openSubmittalFile(newToken(), "GET", async () => approved, resolve)).toBe(
      approved,
    );
    expect(resolve).not.toHaveBeenCalled();
  });
  it("expired, revoked, unknown or malformed links never get a draft redirect", async () => {
    const gone = new Response(null, { status: 410 });
    const resolve = vi.fn(async () => null);
    expect(await openSubmittalFile(newToken(), "GET", async () => gone, resolve)).toBe(gone);
    resolve.mockClear();
    expect(await openSubmittalFile("../malformed", "GET", async () => gone, resolve)).toBe(gone);
    expect(resolve).not.toHaveBeenCalled();
    const bad = await openSubmittalFile(
      newToken(),
      "GET",
      async () => gone,
      async () => ({ ...record, job_id: "https://evil.example" }),
    );
    expect(bad).toBe(gone);
  });
  it("the deployed lookup bounds the hash, expiry, draft state and submittal company/job without returning a file capability", async () => {
    vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-test-only");
    state.filters.length = 0;
    const token = newToken();
    const response = await openSubmittalFile(
      token,
      "GET",
      async () => new Response(null, { status: 410 }),
    );
    expect(response.status).toBe(302);
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ["mcp_submittal_packages", "eq", "token_hash", await tokenHash(token)],
        ["mcp_submittal_packages", "is", "approved_at", null],
        ["mcp_submittal_packages", "is", "revoked_at", null],
        ["mcp_submittals", "eq", "job_id", record.job_id],
        ["mcp_submittals", "eq", "company_id", "fictional-company"],
        ["mcp_submittals", "eq", "id", record.submittal_id],
      ]),
    );
    expect(
      state.filters.some(
        ([table, method, column]) =>
          table === "mcp_submittal_packages" && method === "gt" && column === "expires_at",
      ),
    ).toBe(true);
    expect(response.headers.get("location")).not.toContain("token=");
    expect(response.headers.get("location")).not.toContain("t=");
  });
});
