// "Your photo" on the account page, done on Athena's server: the browser sends the small square JPEG it made, and
// the server stores it in the member's own people/ folder and saves it on their profile. Members can't reach that
// folder from the browser, so no storage policy is needed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PHOTO_MAX_BYTES, sniffPhoto } from "@/lib/photo-file";
import { isPersonPhotoPath, personPhotoPath } from "@/lib/people-photo";
import { dropPersonPhoto, signPersonPhoto, storePersonPhoto } from "@/lib/people-photo.server";

type Sb = {
  rpc: (
    fn: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => PromiseLike<{ data: { photo_path?: string | null } | null }> };
    };
  };
};

async function currentPath(sb: Sb, userId: string): Promise<string | null> {
  const { data } = await sb.from("profiles").select("photo_path").eq("id", userId).maybeSingle();
  return data?.photo_path ?? null;
}

export type MyPhoto = { url: string | null };

export const getMyPhoto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyPhoto> => {
    const path = await currentPath(context.supabase as unknown as Sb, context.userId);
    return { url: isPersonPhotoPath(path, context.userId) ? await signPersonPhoto(path) : null };
  });

export type PhotoSaveResult = { ok: true; url: string | null } | { ok: false; error: string };

// base64 of at most PHOTO_MAX_BYTES; the browser sends about 100 KB.
const MAX_B64 = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;

export const saveMyPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jpeg: z.string().min(16).max(MAX_B64) }).parse)
  .handler(async ({ data, context }): Promise<PhotoSaveResult> => {
    const sb = context.supabase as unknown as Sb;
    const bytes = new Uint8Array(Buffer.from(data.jpeg, "base64"));
    if (!sniffPhoto(bytes, "photo.jpg"))
      return { ok: false, error: "That photo couldn't be read. Choose another picture." };
    const before = await currentPath(sb, context.userId);
    const path = personPhotoPath(context.userId, crypto.randomUUID(), "jpg");
    if (!(await storePersonPhoto(path, bytes, "image/jpeg")))
      return { ok: false, error: "The photo didn't upload. Try again." };
    const r = await sb.rpc("mcp_profile_photo_set", { _path: path });
    if (r.error) {
      await dropPersonPhoto(path);
      return { ok: false, error: "The photo uploaded, but it didn't save. Try again." };
    }
    if (before !== path && isPersonPhotoPath(before, context.userId)) await dropPersonPhoto(before);
    return { ok: true, url: await signPersonPhoto(path) };
  });

export const removeMyPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const sb = context.supabase as unknown as Sb;
    const before = await currentPath(sb, context.userId);
    const r = await sb.rpc("mcp_profile_photo_set", { _path: null });
    if (r.error) return { ok: false };
    if (isPersonPhotoPath(before, context.userId)) await dropPersonPhoto(before);
    return { ok: true };
  });
