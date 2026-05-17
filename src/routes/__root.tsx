import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

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
      { title: "ALP Contractor Circle" },
      { name: "description", content: "The operating environment for serious construction business owners." },
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

const NAV: { to: string; label: string; match?: string }[] = [
  { to: "/", label: "Home" },
  { to: "/tools/growth-constraint", label: "Command Tools", match: "/tools" },
  { to: "/bring-one-issue", label: "Bring One Issue" },
  { to: "/vault", label: "Vault" },
  { to: "/aos", label: "AOS" },
  { to: "/calls", label: "Calls" },
  { to: "/templates", label: "Templates" },
  { to: "/work-with-marshall", label: "Work With Marshall" },
];

function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-display text-[1.35rem] tracking-tight">ALP</span>
          <span className="label-mono mt-0.5">Contractor Circle</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = item.match ? pathname.startsWith(item.match) : pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                  active ? "bg-ink text-cream" : "text-foreground/75 hover:bg-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/account"
          className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10px] font-medium text-cream">M</span>
          <span className="hidden sm:inline">Member</span>
        </Link>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/70 bg-background">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-base text-foreground">ALP</span>
          <span className="label-mono">Operating Environment</span>
        </div>
        <p>Build the company behind the projects.</p>
      </div>
    </footer>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <TopBar />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}
