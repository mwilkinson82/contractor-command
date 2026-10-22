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
vi.mock("@/lib/athena-reviewer-sign-in.functions", () => ({ reviewerPasswordSignIn: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
vi.mock("@/lib/athena-host-current", () => ({
  onAthenaHost: () => false,
  currentHostname: () => "app.alpcontractorcircle.com",
}));
import { Route } from "@/routes/login";
it("connector login asks for an emailed code and does not offer a magic link", () => {
  const html = renderToStaticMarkup(
    createElement((Route as unknown as { component: () => React.ReactNode }).component),
  );
  expect(html).toContain("No password required");
  expect(html).toContain('type="email"');
  expect(html).toContain("Email me a sign-in code");
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain("Use password instead");
  expect(html).not.toContain("Email me a secure sign-in link");
  expect(html).not.toContain("secure sign-in link");
});
