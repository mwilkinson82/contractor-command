import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  navigate: vi.fn(),
  pathname: "/auth/callback",
  session: { user: { id: "owner" } } as object | null,
  companyLoading: false,
  needsOnboarding: true,
}));
vi.mock("react", async (original) => ({
  ...(await original<object>()),
  useEffect: (fn: () => unknown) => m.effects.push(fn),
}));
vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (config: object) => ({
    ...config,
    useRouteContext: () => ({ queryClient: {} }),
  }),
  useRouterState: () => m.pathname,
  useNavigate: () => m.navigate,
  useRouter: () => ({}),
  Outlet: () => null,
  Link: () => null,
  HeadContent: () => null,
  Scripts: () => null,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ session: m.session, loading: false }) }));
vi.mock("@/hooks/use-company", () => ({
  useCompany: () => ({ needsOnboarding: m.needsOnboarding, loading: m.companyLoading }),
}));
vi.mock("@/hooks/use-tier", () => ({
  useTier: () => ({ tier: "circle", loading: false }),
  tierAtLeast: () => true,
}));
vi.mock("@/hooks/use-is-admin", () => ({ useIsAdmin: () => false }));
vi.mock("@/components/portal/app-sidebar", () => ({
  AppSidebar: () => null,
  AppSidebarProvider: () => null,
  SidebarInset: () => null,
}));
vi.mock("@/components/portal/top-strip", () => ({ TopStrip: () => null }));
vi.mock("@/components/portal/tool-drawer", () => ({ ToolDrawerProvider: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/vault", () => ({ vault: {} }));
vi.mock("@/lib/portal-presence", () => ({ setPresence: vi.fn(), resetPresence: vi.fn() }));
import { Route } from "@/routes/__root";
function runGuard() {
  // Invoke the actual root's AuthGate and its navigation effect; no network or DOM.
  type TestElement = { props: { children: TestElement }; type: (props: unknown) => unknown };
  const tree = (Route as unknown as { component: () => TestElement }).component();
  const gate = tree.props.children.props.children;
  gate.type(gate.props);
  m.effects.at(-1)!();
}
beforeEach(() => {
  m.effects = [];
  m.navigate.mockReset();
  m.session = { user: { id: "owner" } };
  m.companyLoading = false;
  m.needsOnboarding = true;
});
it.each(["/auth/callback", "/oauth/consent", "/.lovable/oauth/consent"])(
  "does not interrupt %s after OTP establishes a session",
  (path) => {
    m.pathname = path;
    runGuard();
    expect(m.navigate).not.toHaveBeenCalled();
  },
);
it("still requires onboarding on protected pages after a missing-company result", () => {
  m.pathname = "/";
  runGuard();
  expect(m.navigate).toHaveBeenCalledWith({ to: "/onboarding" });
});
it("does not redirect a protected page while the current company is loading", () => {
  m.pathname = "/";
  m.companyLoading = true;
  runGuard();
  expect(m.navigate).not.toHaveBeenCalled();
});
it("still requires authentication on protected pages", () => {
  m.pathname = "/";
  m.session = null;
  runGuard();
  expect(m.navigate).toHaveBeenCalledWith({
    to: "/login",
    search: { redirect: "/" },
    replace: true,
  });
});
