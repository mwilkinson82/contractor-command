import { defaultUrlTransform } from "react-markdown";

export const ANNOUNCEMENT_MARKDOWN_ELEMENTS = [
  "p",
  "strong",
  "em",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "blockquote",
  "hr",
  "br",
] as const;

export function announcementUrlTransform(url: string, key: string): string {
  const transformed = defaultUrlTransform(url);
  if (!transformed) return "";

  if (key === "src") {
    return /^https:\/\//i.test(transformed) ? transformed : "";
  }

  return /^(https?:\/\/|mailto:)/i.test(transformed) ? transformed : "";
}
