import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { applyBrowserLovableAuthRedirect } from "@/lib/lovable-auth-redirect";
import { routeTree } from "./routeTree.gen";

// Before the router (and any route) renders. A full page load on
// *.lovable.app/oauth or /login is replaced here, with no painted shell.
applyBrowserLovableAuthRedirect();

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
