import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => unknown>,
  user: null as { id: string } | null,
  query: vi.fn(),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = m.cursor++;
    if (!(i in m.slots)) m.slots[i] = initial;
    return [
      m.slots[i],
      (v: unknown) => {
        m.slots[i] = typeof v === "function" ? v(m.slots[i]) : v;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = m.cursor++;
    return (m.slots[i] ??= { current: initial });
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => unknown) => m.effects.push(fn),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: () => m.query(id) }) }),
    }),
  },
}));
import { useCompany } from "./use-company";
const company = (id: string) => ({
  id: `company-${id}`,
  owner_user_id: id,
  name: "Existing company",
  logo_path: null,
});
function useTestCompany() {
  m.cursor = 0;
  m.effects = [];
  return useCompany();
}
function flush() {
  m.effects.forEach((fn) => fn());
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  m.slots = [];
  m.cursor = 0;
  m.effects = [];
  m.user = null;
  m.query.mockReset();
});
it("waits for the signed-in user's lookup even before its effect runs", async () => {
  useTestCompany();
  flush();
  await settle();
  m.user = { id: "A" };
  const pending = deferred();
  m.query.mockReturnValue(pending.promise);
  const first = useTestCompany();
  expect(first.loading).toBe(true);
  expect(first.needsOnboarding).toBe(false);
  flush();
  pending.resolve({ data: company("A"), error: null });
  await settle();
  const loaded = useTestCompany();
  expect(loaded.company?.name).toBe("Existing company");
  expect(loaded.needsOnboarding).toBe(false);
});
it("does not reuse the previous account's missing-company result", async () => {
  m.user = { id: "A" };
  m.query.mockResolvedValue({ data: null, error: null });
  useTestCompany();
  flush();
  await settle();
  expect(useTestCompany().needsOnboarding).toBe(true);
  m.user = { id: "B" };
  const next = useTestCompany();
  expect(next.loading).toBe(true);
  expect(next.needsOnboarding).toBe(false);
});
it("ignores a late response for the previous identity", async () => {
  const a = deferred(),
    b = deferred();
  m.query.mockImplementation((id) => (id === "A" ? a.promise : b.promise));
  m.user = { id: "A" };
  useTestCompany();
  flush();
  m.user = { id: "B" };
  useTestCompany();
  flush();
  b.resolve({ data: company("B"), error: null });
  await settle();
  a.resolve({ data: company("A"), error: null });
  await settle();
  expect(useTestCompany().company?.owner_user_id).toBe("B");
});
it("does not interpret a failed lookup as a missing company", async () => {
  m.user = { id: "A" };
  m.query.mockResolvedValue({ data: null, error: { message: "network unavailable" } });
  useTestCompany();
  flush();
  await settle();
  expect(useTestCompany().needsOnboarding).toBe(false);
});
it("still requires setup after a successful empty lookup", async () => {
  m.user = { id: "A" };
  m.query.mockResolvedValue({ data: null, error: null });
  useTestCompany();
  flush();
  await settle();
  expect(useTestCompany().needsOnboarding).toBe(true);
});
