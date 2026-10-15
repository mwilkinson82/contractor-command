import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "./use-auth";
import { listCircleSessions } from "@/lib/circle-sessions/sessions.functions";
import { sessionHubUrl } from "@/lib/circle-sessions/model";
import type { Session } from "@/lib/program";

export function useCircleSessions() {
  const { user } = useAuth();
  const list = useServerFn(listCircleSessions);
  const query = useQuery({
    queryKey: ["circle-sessions", user?.id],
    queryFn: () => list(),
    enabled: !!user,
    retry: false,
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const sessions: Session[] = (query.data ?? [])
    .filter((s) => Date.parse(s.starts_at) + s.duration_min * 60_000 > Date.now())
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      date: s.starts_at,
      durationMin: s.duration_min,
      timeZone: s.time_zone,
      description: s.description,
      zoomUrl: sessionHubUrl(s.id),
      meetingProvider: "Google Meet",
    }));
  return { ...query, sessions };
}
