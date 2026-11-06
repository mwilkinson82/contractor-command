// Where a member's own photo is kept: the existing private athena-progress bucket, under people/<user id>/. No new
// bucket and no storage policy is needed (Lovable Cloud can't create either from SQL). Members never touch this
// folder directly: the progress-photo storage rules only reach company/job paths, so only Athena's server reads
// and writes it, for the member who is signed in.
export const PEOPLE_BUCKET = "athena-progress";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^people/(${UUID})/[A-Za-z0-9._-]{1,80}$`);

/** The member's own photo path. Same shape the database checks in mcp_profile_photo_set. */
export const personPhotoPath = (userId: string, id: string, ext: "jpg" | "png" | "webp") =>
  `people/${userId}/photo-${id}.${ext}`;

/** True only for a photo path in people/, and when userId is given, only in that member's own folder. */
export function isPersonPhotoPath(path: unknown, userId?: string): path is string {
  if (typeof path !== "string") return false;
  const m = PATH.exec(path);
  return !!m && (userId === undefined || m[1] === userId);
}
