// Visible labels are the activity name, the item title, and the owner.
// Raw ids, uuids, and hex refs stay in data attributes or small secondary text.
import type { CardRow } from "./cards/model";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_REF = /#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
const HASH_NUM = /#\d{1,4}\b/g;
const RAW_CELL = /^(?:#[0-9A-Fa-f]{3,8}|#\d{1,4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function detailAnchor(kind: "activity" | "item" | "daily" | "photo" | "line" | "risk" | "submittal", id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `${kind}-${safe || "item"}`;
}

/** Hosted board links only. Anything else is not turned into an anchor. */
export function safeBoardHref(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "app.meetathena.io") return null;
    if (!url.pathname.startsWith("/r/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function withAnchor(url: string | null | undefined, anchor: string): string | null {
  if (!url) return null;
  return `${url.split("#")[0]}#${anchor}`;
}

/** Markdown link when the href is a hosted board page. The label is the words, not the id. */
export function mdLink(label: string, href: string | null | undefined): string {
  const text = label.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim() || "Item";
  const safe = safeBoardHref(href);
  return safe ? `[${text}](${safe})` : text;
}

export type Plain = { label: string; href: string | null; refId: string | null };

/** One cell or line: drop uuid, hex, and #n tokens from the words a person reads. */
export function plainLabel(text: string): Plain {
  const link = text.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
  let body = text.replace(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, (_, href: string) => (link ? "" : href));
  if (link) body = `${link[1]} ${body}`;
  const uuid = body.match(UUID)?.[0] ?? null;
  const hex = body.match(HEX_REF)?.[0] ?? null;
  const hashNum = body.match(HASH_NUM)?.[0] ?? null;
  if (RAW_CELL.test(body.trim())) body = "";
  body = body.replace(UUID, " ").replace(HEX_REF, " ").replace(HASH_NUM, " ");
  body = body.replace(/\s+/g, " ").replace(/[,\s]*·[,\s]*·/g, " · ").replace(/^[,·\s-]+|[,·\s-]+$/g, "").trim();
  return {
    label: body || "Item",
    href: link?.[2] ?? null,
    refId: uuid ?? hex ?? hashNum,
  };
}

/** Activity codes may show as small secondary text. Hex refs and uuids stay in data-id only. */
export function secondaryRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("#") || UUID.test(ref)) return null;
  return ref;
}

export function rowPlain(row: CardRow): Plain & { secondary: string | null } {
  const parts = row.cells.map((c) => plainLabel(c));
  const label = parts.map((p) => (p.label === "Item" && RAW_CELL.test(p.refId ?? "") ? "" : p.label)).filter((l) => l && l !== "Item").join(" · ") || parts.find((p) => p.label && p.label !== "Item")?.label || "Item";
  const href = safeBoardHref(row.href ?? parts.find((p) => p.href)?.href ?? null);
  const refId = row.refId ?? parts.find((p) => p.refId)?.refId ?? null;
  return { label, href, refId, secondary: secondaryRef(refId) };
}
