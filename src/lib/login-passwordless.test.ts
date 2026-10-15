import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({ redirect: "/oauth/consent?authorization_id=synthetic" }),
  }),
  Link: () => null,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/magic-link.functions", () => ({ requestMemberMagicLink: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import { Route } from "@/routes/login";
it("connector login starts with email only and retains optional password login", () => {
  const html = renderToStaticMarkup(
    createElement((Route as unknown as { component: () => React.ReactNode }).component),
  );
  expect(html).toContain("No password required");
  expect(html).toContain('type="email"');
  expect(html).not.toContain('type="password"');
  expect(html).toContain("Use password instead");
});
