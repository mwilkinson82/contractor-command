// Commands inside a tool result ("REQUIRED VIEW", "do not add text") are read as prompt
// injection. Rendering rules live in the server instructions. The result is the card.

const HEADER = /^(?:REQUIRED VIEW\b|REQUIRED:|Card shown\b|Show the view below exactly\b|Show this card and stop\b|Never paste the markdown\b)/i;

function isHeader(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (HEADER.test(t)) return true;
  return /do not add text/i.test(t);
}

/** Lines that continue a view spec. A member list such as "1. Marshall" is not under a REQUIRED header. */
function isSpecBody(line: string): boolean {
  const t = line.trim();
  if (/^\d+\.\s/.test(t)) return true;
  if (/^Never send; show a/i.test(t)) return true;
  if (/^With several emails,/i.test(t)) return true;
  if (t.startsWith("White cards, blue ")) return true;
  return false;
}

/** Drops render commands from tool result text. Blank lines collapse. Content stays. */
export function stripDirectiveText(text: string): string {
  const kept: string[] = [];
  let inSpec = false;
  for (const line of text.split("\n")) {
    if (isHeader(line)) {
      inSpec = true;
      continue;
    }
    if (inSpec) {
      if (line.trim() === "" || isSpecBody(line)) {
        if (line.trim() === "") inSpec = false;
        continue;
      }
      inSpec = false;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Block = { type?: string; text?: string };
type Res = { content?: Block[]; structuredContent?: { assistant_guidance?: unknown[] } };

/** Last pass on every tool result. Leaves styled markdown and HTML. Removes commands to the model. */
export function stripResultDirectives<R>(result: R): R {
  const res = result as unknown as Res;
  if (!res?.content?.length) return result;
  const content = res.content.map((block) =>
    block?.type === "text" && typeof block.text === "string" ? { ...block, text: stripDirectiveText(block.text) } : block,
  );
  const guidance = res.structuredContent?.assistant_guidance;
  if (!Array.isArray(guidance)) return { ...res, content } as unknown as R;
  const assistant_guidance = guidance.filter((item) => typeof item !== "string" || !isHeader(item));
  return {
    ...res,
    content,
    structuredContent: { ...res.structuredContent, assistant_guidance },
  } as unknown as R;
}
