import { supabase } from "@/integrations/supabase/client";

export type TemplateRow = {
  id: string;
  title: string;
  category: string;
  description: string;
  long_description: string | null;
  download_url: string | null;
  file_type: string;
  pages: string | null;
  badge: string | null;
  highlights: string[];
  featured: boolean;
  published: boolean;
  created_at: string;
};

export type ReplayRow = {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_minutes: number | null;
  recorded_at: string;
  published: boolean;
  tags: string[];
  created_at: string;
};

export const TEMPLATE_BUCKET = "template-files";

/** Open a template file. External URLs open directly; storage paths get a short-lived signed URL. */
export async function openTemplateFile(downloadUrl: string | null): Promise<string | null> {
  if (!downloadUrl) return null;
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  const { data, error } = await supabase.storage
    .from(TEMPLATE_BUCKET)
    .createSignedUrl(downloadUrl, 60 * 5);
  if (error) {
    console.error("[library] signed url failed", error);
    return null;
  }
  return data.signedUrl;
}
