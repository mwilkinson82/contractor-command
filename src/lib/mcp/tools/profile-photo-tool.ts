// Nov 2026: a member sets their own photo by sending it to Athena in chat. The photo shows in "Your team" on the
// client page of every job they run as PM (Marshall, Nov 6: "so they get a picture of who their project manager
// is"). Athena's server stores it in the member's own people/ folder of the private athena-progress bucket, the same
// place the account page's "Your photo" upload puts it, and the client page server signs it for each visit.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fetchAllowedFile } from "../file-upload";
import { drawingFile } from "../drawing-file-input";
import { FileRejected } from "../file-share";
import { run, text } from "../guard";
import { guide } from "../visible";
import { PHOTO_MAX_BYTES, photoImageInfo, sniffPhoto } from "../../photo-file";
import { ACCOUNT_URL } from "./account-tools";
import { personPhotoPath } from "../../people-photo";
import { dropPersonPhoto, storePersonPhoto } from "../../people-photo.server";

/** A face is recognizable well below a site photo's size, but a thumbnail copy is not the real picture. */
const MIN_EDGE = 200;
const SAVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const onAccountPage = `Or add it on your account page: ${ACCOUNT_URL} (the "You" card, "Add your photo").`;

export const profilePhoto = defineTool({
  name: "profile_photo",
  title: "Set my photo",
  description:
    "Sets or removes the member's own profile photo, the picture of them that clients see in 'Your team' on the client page of the jobs they run as PM. Pass the photo attached in chat as file. Without a file it returns the account page link where they can add one. Only the member's own photo, never someone else's.",
  inputSchema: {
    // A photo attached in ChatGPT arrives as file (openai/fileParams), the original as uploaded.
    file: drawingFile,
    remove: z
      .boolean()
      .optional()
      .describe("true to take the photo off; clients then see the company logo"),
  },
  annotations: SAVE,
  handler: (args, ctx) =>
    run("profile_photo", ctx, {}, async (sb) => {
      const me = ctx.getUserId?.();
      if (!me) throw new ToolError("Sign in to Athena to set your photo.");
      const set = async (path: string | null) => {
        const { error } = await (
          sb.rpc as unknown as (
            fn: string,
            a: Record<string, unknown>,
          ) => PromiseLike<{ error: { message: string } | null }>
        )("mcp_profile_photo_set", { _path: path });
        if (error) throw new ToolError(`Athena couldn't save your photo. ${onAccountPage}`);
      };
      if (args.remove === true) {
        await set(null);
        return guide(
          {
            ...text(
              "Your photo is off. Clients see your company's logo in Your team instead, or your initials if there's no logo.",
            ),
            structuredContent: { saved: true, removed: true },
          },
          "Say the photo was removed. Don't offer to add someone else's photo.",
        );
      }
      if (!args.file) {
        return guide(
          {
            ...text(
              `Send me a clear photo of your face here in chat and I'll set it. ${onAccountPage}`,
            ),
            structuredContent: { saved: false, needs_photo: true, url: ACCOUNT_URL },
          },
          "Ask for the member's own photo, or give the account page link. Never make, edit or describe a photo for them.",
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await fetchAllowedFile(args.file.download_url, PHOTO_MAX_BYTES);
      } catch (e) {
        throw new ToolError(
          (e instanceof FileRejected
            ? e.message.replace(/Nothing was stored\.?$/, "Nothing was saved.")
            : "Athena couldn't read the attached photo. Nothing was saved.") + ` ${onAccountPage}`,
        );
      }
      const name = args.file.file_name ?? "photo.jpg";
      const sniffed =
        sniffPhoto(bytes, name) ??
        sniffPhoto(bytes, "a.jpg") ??
        sniffPhoto(bytes, "a.png") ??
        sniffPhoto(bytes, "a.webp");
      if (!sniffed)
        throw new ToolError(
          `Use a JPEG, PNG or WebP photo under 8 MB. Nothing was saved. ${onAccountPage}`,
        );
      const image = photoImageInfo(bytes, sniffed.ext);
      if (!image)
        throw new ToolError(
          `The photo file is damaged or incomplete. Attach the original again. Nothing was saved. ${onAccountPage}`,
        );
      if (Math.max(image.width, image.height) < MIN_EDGE)
        throw new ToolError(
          `That's a small preview (${image.width} × ${image.height} pixels), not the photo itself. Attach the original. Nothing was saved. ${onAccountPage}`,
        );
      const path = personPhotoPath(me, crypto.randomUUID(), sniffed.ext);
      if (!(await storePersonPhoto(path, bytes, sniffed.mime)))
        throw new ToolError(`The photo wasn't stored. Nothing was saved. ${onAccountPage}`);
      try {
        await set(path);
      } catch (e) {
        await dropPersonPhoto(path);
        throw e;
      }
      return guide(
        {
          ...text(
            "Your photo is saved. Clients see it in Your team on the client page of the jobs you run as project manager.",
          ),
          structuredContent: { saved: true, width: image.width, height: image.height },
        },
        "Say the photo is saved and where clients see it. Don't describe the person in the photo.",
      );
    }),
});
