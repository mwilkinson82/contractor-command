import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/magic-link")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});