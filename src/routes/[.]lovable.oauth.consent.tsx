import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy consent path: forward to /oauth/consent with the same authorization_id.
export const Route = createFileRoute("/.lovable/oauth/consent")({
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/oauth/consent", search: { authorization_id: search.authorization_id }, replace: true });
  },
  head: () => ({ meta: [{ title: "Approve connection — ALP Contractor Circle" }, { name: "robots", content: "noindex, nofollow" }] }),
});
