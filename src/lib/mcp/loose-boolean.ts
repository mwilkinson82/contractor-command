import { z } from "zod";

/**
 * A boolean input that also takes the strings "true" and "false". AI clients
 * holding an older copy of a tool's schema send a new boolean field as a
 * string; this reads it the same as the real boolean. Anything else is still
 * refused, so "yes", "1" or "" never count as true.
 */
export const looseBoolean = () =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim().toLowerCase();
    return s === "true" ? true : s === "false" ? false : v;
  }, z.boolean());
