import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ReplayRow, TemplateRow } from "@/lib/library";

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
    queryFn: async (): Promise<ReplayRow[]> => {
      const { data, error } = await supabase
        .from("replays")
        .select("*")
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data as ReplayRow[]) ?? [];
    },
  });
