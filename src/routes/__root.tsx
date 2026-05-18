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
import { useAuth } from "@/hooks/use-auth";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { vault } from "@/lib/vault";

const PUBLIC_ROUTES = new Set(["/login", "/signup"]);
const ONBOARDING_ROUTE = "/onboarding";

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
        <p className="mt-2 text-sm text-muted-foreground">Try again, or head back to the command center.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90"
          >
            Try again
          </button>
          <a href="/" className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted">
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
      { title: "ALP Contractor Circle — Command Center" },
      { name: "description", content: "The operating environment for serious construction business owners." },
      { property: "og:title", content: "ALP Contractor Circle — Command Center" },
      { name: "twitter:title", content: "ALP Contractor Circle — Command Center" },
      { property: "og:description", content: "The operating environment for serious construction business owners." },
      { name: "twitter:description", content: "The operating environment for serious construction business owners." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/15a4c1a0-be64-49a7-9625-ccc9acf09437/id-preview-50072c33--362c776b-68ab-4871-bedb-c42cb9843c1b.lovable.app-1779076615220.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/15a4c1a0-be64-49a7-9625-ccc9acf09437/id-preview-50072c33--362c776b-68ab-4871-bedb-c42cb9843c1b.lovable.app-1779076615220.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        {(showShell) =>
          showShell ? (
            <AppSidebarProvider>
              <ToolDrawerProvider>
                <div className="bg-background text-foreground">
                  <AppSidebar />
                  <SidebarInset>
                    <TopStrip />
                    <main>
                      <Outlet />
                    </main>
                  </SidebarInset>
                </div>
              </ToolDrawerProvider>
            </AppSidebarProvider>
          ) : (
            <Outlet />
          )
        }
      </AuthGate>
    </QueryClientProvider>
  );
}

function AuthGate({ children }: { children: (showShell: boolean) => React.ReactNode }) {
  const { session, loading } = useAuth();
  const { needsOnboarding, loading: companyLoading } = useCompany();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const router = useRouter();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const isOnboarding = pathname === ONBOARDING_ROUTE;

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
  // can see who's online right now.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const channel = supabase.channel("portal-presence", {
      config: { presence: { key: uid } },
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
    };
  }, [session?.user?.id, session?.user?.email]);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      navigate({ to: "/login" });
      return;
    }
    if (session && !companyLoading && needsOnboarding && !isOnboarding) {
      navigate({ to: "/onboarding" });
    }
  }, [loading, session, isPublic, isOnboarding, companyLoading, needsOnboarding, navigate]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Loading workspace…
        </p>
      </div>
    );
  }

  if (isPublic) return <>{children(false)}</>;
  if (!session) return null;
  // Onboarding renders without the app shell — it's a focused setup screen.
  if (isOnboarding) return <>{children(false)}</>;
  return <>{children(true)}</>;
}
