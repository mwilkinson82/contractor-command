import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReplayResource, ReplayRow, ReplayWithResources, TemplateRow } from "@/lib/library";

const LEGACY_FEATURED_TRAINING: ReplayWithResources = {
  id: "legacy-daily-project-wip",
  title: "Daily Project WIP Implementation",
  description:
    "A practical implementation session for connecting field activity, crew hours, installed quantities, CPM activities, SOV lines, billing events, and IOR so production becomes provable and billable every day.",
  video_url: "https://www.loom.com/embed/22d11e96c7084343b7160092a53575b9",
  share_url: "https://www.loom.com/share/22d11e96c7084343b7160092a53575b9",
  thumbnail_url: null,
  duration_minutes: 12,
  recorded_at: "2026-07-09T21:00:00.000Z",
  published: true,
  featured: true,
  tags: ["Daily WIP", "Field Tracking", "Billing", "IOR", "Implementation"],
  category: "circle_call",
  created_at: "2026-07-09T21:00:00.000Z",
  resources: [],
};

async function loadReplayResources(replayIds: string[]): Promise<ReplayResource[]> {
  if (replayIds.length === 0) return [];
  const { data, error } = await supabase
    .from("replay_resources")
    .select(
      "id, replay_id, template_id, sort_order, template:templates(id, title, description, download_url, file_type, pages, badge)",
    )
    .in("replay_id", replayIds)
    .order("sort_order", { ascending: true });
  if (error) {
    // Keep the replay usable during a short schema rollout window.
    console.warn("[library] replay resources unavailable", error.message);
    return [];
  }
  return (data as unknown as ReplayResource[]) ?? [];
}

async function attachResources(rows: ReplayRow[]): Promise<ReplayWithResources[]> {
  const resources = await loadReplayResources(rows.map((row) => row.id));
  const byReplay = new Map<string, ReplayResource[]>();
  for (const resource of resources) {
    const list = byReplay.get(resource.replay_id) ?? [];
    list.push(resource);
    byReplay.set(resource.replay_id, list);
  }
  return rows.map((row) => ({ ...row, resources: byReplay.get(row.id) ?? [] }));
}

export const templatesQueryOptions = () =>
  queryOptions({
    queryKey: ["templates"],
    staleTime: 60_000,
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as TemplateRow[]) ?? [];
    },
  });

export const replaysQueryOptions = () =>
  queryOptions({
    queryKey: ["replays"],
    staleTime: 60_000,
    queryFn: async (): Promise<ReplayWithResources[]> => {
      const { data, error } = await supabase
        .from("replays")
        .select("*")
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return attachResources((data as ReplayRow[]) ?? []);
    },
  });

export const featuredReplayQueryOptions = () =>
  queryOptions({
    queryKey: ["replays", "featured"],
    staleTime: 60_000,
    queryFn: async (): Promise<ReplayWithResources> => {
      const { data, error } = await supabase
        .from("replays")
        .select("*")
        .eq("featured", true)
        .eq("published", true)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        if (error) console.warn("[library] featured replay unavailable", error.message);
        return LEGACY_FEATURED_TRAINING;
      }
      const [featured] = await attachResources([data as ReplayRow]);
      return featured ?? LEGACY_FEATURED_TRAINING;
    },
  });
