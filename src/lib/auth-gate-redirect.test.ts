import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { signedOutReturnPath } from "./auth-gate-redirect";

describe("signed-out auth redirect", () => {
  it("does not wrap a pending login navigation in another login redirect", async () => {
    let releaseLogin!: () => void;
    let loginStarted!: () => void;
    const started = new Promise<void>((resolve) => { loginStarted = resolve; });
    const pending = new Promise<void>((resolve) => { releaseLogin = resolve; });
    const root = createRootRoute();
    const admin = createRoute({ getParentRoute: () => root, path: "/admin" });
    const login = createRoute({
      getParentRoute: () => root,
      path: "/login",
      beforeLoad: async () => { loginStarted(); await pending; },
    });
    const history = createMemoryHistory({ initialEntries: ["/admin?tab=members#details"] });
    const router = createRouter({ routeTree: root.addChildren([admin, login]), history });
    await router.load();
    const renderedPathname = router.state.location.pathname;
    const target = signedOutReturnPath(router.latestLocation);
    expect(target).toBe("/admin?tab=members#details");
    history.replace(`/login?redirect=${encodeURIComponent(target!)}`);
    const navigation = router.load();
    await started;
    try {
      // The old effect's captured protected route remains stale while history
      // already contains /login. Using that URL again nests the redirect.
      expect(renderedPathname).toBe("/admin");
      expect(history.location.pathname).toBe("/login");
      expect(history.location.search).toContain("redirect=");
      const oldNested = `/login?redirect=${encodeURIComponent(history.location.href)}`;
      expect(decodeURIComponent(oldNested)).toContain("redirect=/login?redirect=");
      expect(signedOutReturnPath(router.latestLocation)).toBeNull();
    } finally {
      releaseLogin();
      await navigation;

    }
    expect(new URL(history.location.href, "https://example.test").searchParams.get("redirect"))
      .toBe("/admin?tab=members#details");
  });

  it.each(["/login", "/auth/callback", "/reset-password", "/oauth/consent", "/.lovable/oauth/consent"])(
    "leaves public auth route %s alone", (pathname) => {
      expect(signedOutReturnPath({ pathname, href: `${pathname}?authorization_id=keep-me` })).toBeNull();
    },
  );
});
