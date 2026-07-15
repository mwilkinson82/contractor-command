import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { AppSidebar, AppSidebarProvider, SidebarInset } from "@/components/portal/app-sidebar";
import { TopStrip } from "@/components/portal/top-strip";
import { ToolDrawerProvider } from "@/components/portal/tool-drawer";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { useTier, tierAtLeast, type Tier } from "@/hooks/use-tier";
import { START_HERE_MIN_TIER } from "@/lib/start-here-access";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import { vault } from "@/lib/vault";
import { setPresence, resetPresence, type PresenceUser } from "@/lib/portal-presence";
import { toast } from "sonner";

const PUBLIC_ROUTES = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/welcome",
  "/scheduler-preview",
]);
const ONBOARDING_ROUTE = "/onboarding";
const APP_ORIGIN = "https://app.alpcontractorcircle.com";
const DEFAULT_TITLE = "Command Center — ALP Contractor Circle";
const DEFAULT_DESCRIPTION =
  "The private member portal for Contractor Circle: live calls with Marshall, AOS access, replays, templates, Ask Marshall, and the operating process behind the projects.";
const SOCIAL_IMAGE_URL = `${APP_ORIGIN}/og-command-center-v2.png`;

// Run before the app shell mounts. Auth links can arrive at "/" with tokens in
// the hash; if the auth gate mounts first, it may send the user to /login and
// preserve the tokens as inert redirect text. Move those hits to the callback
// route immediately so the tokens are consumed as a session.
if (typeof window !== "undefined" && window.location.pathname !== "/auth/callback") {
  const authHash = window.location.hash.replace(/^#/, "");
  if (authHash) {
    const authParams = new URLSearchParams(authHash);
    if (
      authParams.get("access_token") ||
      authParams.get("refresh_token") ||
      authParams.get("error") ||
      authParams.get("error_code")
    ) {
      const target = authParams.get("type") === "recovery" ? "/reset-password" : "/auth/callback";
      window.location.replace(`${target}#${authHash}`);
    }
  }
}

// Tier gates per route prefix. Anything not listed is open to every signed-in
// user. Tiers ranked in src/hooks/use-tier.ts. Hardcore recorded classes are
// not housed in this hub; /hardcore is only an explanatory notice for bad links.
//
// ALP Handbook buyers (book_buyer) get: Start Here + Handbook + AOS + OverWatch Free + Ask + Tools + Vault.
// - Start Here / OverWatch Free / Ask / Vault / Tools / Field tools → book_buyer and up (handbook entitlement)
// - Community → power_hour and up (room is for paying members)
// - Replays → book_buyer and up (per-category gating happens in the page + RLS)
// - Templates / Calls → Circle and up
const ROUTE_TIER_GATES: Array<{ prefix: string; min: Tier }> = [
  { prefix: "/vault", min: "book_buyer" },
  { prefix: "/tools", min: "book_buyer" },
  { prefix: "/control-plan", min: "book_buyer" },
  { prefix: "/field-tools", min: "book_buyer" },
  { prefix: "/ask", min: "book_buyer" },
  { prefix: "/community", min: "power_hour" },
  { prefix: "/start-here", min: START_HERE_MIN_TIER },
  { prefix: "/templates", min: "circle" },
  { prefix: "/calls", min: "circle" },
  { prefix: "/overwatch", min: "book_buyer" },
];

function gateFor(pathname: string): Tier | null {
  const hit = ROUTE_TIER_GATES.find(
    (g) => pathname === g.prefix || pathname.startsWith(g.prefix + "/"),
  );
  return hit?.min ?? null;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="label-mono">404</p>
        <h1 className="mt-3 text-4xl font-display">This page isn't part of the portal.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-90"
          >
            Back to command center
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display">This page didn't load.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try again, or head back to the command center.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: DEFAULT_TITLE },
      { name: "application-name", content: "ALP Contractor Circle" },
      { name: "apple-mobile-web-app-title", content: "Contractor Circle" },
      { name: "theme-color", content: "#FAF9F5" },
      { name: "robots", content: "index, follow" },
      {
        name: "description",
        content: DEFAULT_DESCRIPTION,
      },
      { property: "og:title", content: DEFAULT_TITLE },
      { property: "og:site_name", content: "ALP Contractor Circle" },
      { property: "og:url", content: APP_ORIGIN },
      { name: "twitter:title", content: DEFAULT_TITLE },
      {
        property: "og:description",
        content: DEFAULT_DESCRIPTION,
      },
      {
        name: "twitter:description",
        content: DEFAULT_DESCRIPTION,
      },
      {
        property: "og:image",
        content: SOCIAL_IMAGE_URL,
      },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "ALP Contractor Circle Command Center branded preview.",
      },
      {
        name: "twitter:image",
        content: SOCIAL_IMAGE_URL,
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: APP_ORIGIN },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Caveat:wght@400;600&family=JetBrains+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap",
      },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/app-icon-192.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="top-center" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useGlobalReveal();
  return (
    <QueryClientProvider client={queryClient}>
      <ToolDrawerProvider>
        <AuthGate>
          {(showShell) =>
            showShell ? (
              <AppSidebarProvider>
                <div className="min-w-0 max-w-full overflow-x-clip bg-background text-foreground">
                  <AppSidebar />
                  <SidebarInset>
                    <TopStrip />
                    <main className="min-w-0 max-w-full overflow-x-clip">
                      <Outlet />
                    </main>
                  </SidebarInset>
                </div>
              </AppSidebarProvider>
            ) : (
              <Outlet />
            )
          }
        </AuthGate>
      </ToolDrawerProvider>
    </QueryClientProvider>
  );
}

/**
 * App-wide entrance + scroll reveal.
 * Auto-tags the top-level children of <main> with [data-reveal] + a small
 * stagger and observes them so every route gets a soft entrance and
 * fade-in-on-scroll without per-page edits. Respects prefers-reduced-motion.
 */
function useGlobalReveal() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (pathname === "/handbook") {
      document
        .querySelector("main")
        ?.querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((el) => {
          el.removeAttribute("data-reveal");
          el.removeAttribute("data-reveal-delay");
          el.classList.remove("is-visible");
        });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    const tag = () => {
      const main = document.querySelector("main");
      if (main) {
        const kids = Array.from(main.children) as HTMLElement[];
        kids.forEach((el, i) => {
          if (!el.hasAttribute("data-reveal")) {
            el.setAttribute("data-reveal", "");
            el.setAttribute("data-reveal-delay", String(Math.min(i, 6)));
          }
        });
      }
      document
        .querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)")
        .forEach((el) => observer.observe(el));
    };

    const raf = requestAnimationFrame(tag);
    const t = setTimeout(tag, 250);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      observer.disconnect();
    };
  }, [pathname]);
}

function getAuthHashTarget(
  pathname: string,
): { path: "/auth/callback" | "/reset-password"; hash: string } | null {
  if (typeof window === "undefined") return null;
  if (pathname === "/auth/callback" || pathname === "/reset-password") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const hasAuthHash =
    params.get("access_token") ||
    params.get("refresh_token") ||
    params.get("error") ||
    params.get("error_code");
  if (!hasAuthHash) return null;
  return { path: params.get("type") === "recovery" ? "/reset-password" : "/auth/callback", hash };
}

function LoadingWorkspace() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Loading workspace…
      </p>
    </div>
  );
}

function AuthGate({ children }: { children: (showShell: boolean) => React.ReactNode }) {
  const { session, loading } = useAuth();
  const { needsOnboarding, loading: companyLoading } = useCompany();
  const { tier, loading: tierLoading } = useTier();
  const isAdmin = useIsAdmin();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const authHashTarget = getAuthHashTarget(pathname);
  const navigate = useNavigate();
  const router = useRouter();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const isOnboarding = pathname === ONBOARDING_ROUTE;

  // Some auth emails still land back at "/" with Supabase tokens in the URL
  // hash ("#access_token=...&refresh_token=...") or with an expired-link
  // error hash. The protected app shell cannot consume those reliably, so it
  // can strand the user on "Loading workspace…". Forward any auth hash to the
  // dedicated callback page, which can set the session or show the expired
  // link state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pathname === "/auth/callback") return;
    if (authHashTarget) {
      window.location.replace(`${authHashTarget.path}#${authHashTarget.hash}`);
    }
  }, [pathname, authHashTarget]);

  // Invalidate router caches + sync vault when auth changes
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      router.invalidate();
      if (s?.user?.id) {
        void vault.hydrateFor(s.user.id);
      } else {
        vault.reset();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (session?.user?.id) void vault.hydrateFor(session.user.id);
  }, [session?.user?.id]);

  // Portal presence — every signed-in user joins a shared channel so admins
  // can see who's online right now. The presence "sync" listener MUST be
  // attached before .subscribe() or presenceState() will stay empty on this
  // client.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      resetPresence();
      return;
    }
    const channel = supabase.channel("portal-presence", {
      config: { presence: { key: uid } },
    });
    channel.on("presence", { event: "sync" }, () => {
      setPresence(channel.presenceState() as Record<string, PresenceUser[]>);
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: uid,
          email: session?.user?.email ?? null,
          at: new Date().toISOString(),
        });
      }
    });
    return () => {
      void supabase.removeChannel(channel);
      resetPresence();
    };
  }, [session?.user?.id, session?.user?.email]);

  useEffect(() => {
    if (loading) return;
    if (authHashTarget) return;
    if (!session && !isPublic) {
      const redirectTo =
        typeof window === "undefined"
          ? pathname
          : `${window.location.pathname}${window.location.search}${window.location.hash}`;
      navigate({ to: "/login", search: { redirect: redirectTo }, replace: true });
      return;
    }
    if (session && !companyLoading && needsOnboarding && !isOnboarding) {
      navigate({ to: "/onboarding" });
      return;
    }
    // Tier gate: redirect to /upgrade when current tier doesn't meet the
    // route's minimum. Admins always pass. Wait for tier to load before
    // judging. Home and other ungated routes stay open to every tier.
    if (session && !tierLoading && !isAdmin) {
      const required = gateFor(pathname);
      if (required && !tierAtLeast(tier, required)) {
        toast.info("That's a locked feature — here's how to unlock it.");
        navigate({ to: "/upgrade" });
      }
    }
  }, [
    loading,
    session,
    isPublic,
    isOnboarding,
    companyLoading,
    needsOnboarding,
    tierLoading,
    tier,
    isAdmin,
    pathname,
    authHashTarget,
    navigate,
  ]);

  if (authHashTarget) return <LoadingWorkspace />;

  if (isPublic) return <>{children(false)}</>;

  if (loading) {
    return <LoadingWorkspace />;
  }

  if (!session) return null;
  // Onboarding renders without the app shell — it's a focused setup screen.
  if (isOnboarding) return <>{children(false)}</>;
  return <>{children(true)}</>;
}
