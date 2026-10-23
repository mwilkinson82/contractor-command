import { sha256Hex } from "./file-share";
/** Server-built covers and immutable packages. Source bytes are never rewritten. */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PackageItem, SubmittalRecord } from "./submittals";
export const SUBMITTAL_BUCKET = "athena-submittals";
export const PACKAGE_MAX_BYTES = 50 * 1024 * 1024;
export type PackageArtifact = {
  id: string;
  filename: string;
  path: string;
  fingerprint: string;
  download_url: string;
  signed_url: string;
  expires_at: string;
  approved_at: string | null;
  sent_at?: string | null;
  revoked_at: string | null;
  page_count: number;
};
export type PackageContext = {
  is_current?: boolean;
  submittal: SubmittalRecord & { company_id: string; job_id: string };
  items: PackageItem[];
  brand: {
    name: string;
    logo_url?: string | null;
    contact_phone?: string | null;
    license_number?: string | null;
    website?: string | null;
  };
  job_number: string;
  job_name: string;
  today: string;
  transmittal_number: number;
  fingerprint: string;
  package: PackageArtifact | null;
};
export type PackageFile = { item: PackageItem; name: string; bytes: Uint8Array };
export function storedPiece(
  ref: string,
  company: string,
  job: string,
): { bucket: string; path: string; name: string } {
  const match = /^(athena-submittals|athena-files|athena-drawings)\/(.+)$/.exec(ref);
  if (
    !match ||
    !match[2].startsWith(`${company}/${job}/`) ||
    /(?:^|\/)\.\.?\//.test(match[2]) ||
    /[?#\\]/.test(ref) ||
    /\p{Cc}/u.test(ref)
  )
    throw new Error("Use a file stored on this job; external links must be imported first.");
  return { bucket: match[1], path: match[2], name: match[2].split("/").at(-1)! };
}
export function packageGaps(ctx: PackageContext): string[] {
  const gaps: string[] = [];
  if (!ctx.brand?.name?.trim()) gaps.push("Company letterhead name");
  if (
    !ctx.submittal.spec_section?.trim() ||
    /^(needed|unknown|n\/?a|tbd)$/i.test(ctx.submittal.spec_section.trim())
  )
    gaps.push("Required spec section");
  if (!(ctx.transmittal_number > 0)) gaps.push("Transmittal number");
  if (!ctx.items.some((item) => item.required !== false))
    gaps.push("Package checklist: identify the required cuts, drawings and documents");
  for (const item of ctx.items)
    if (
      item.required !== false &&
      (!["received", "approved"].includes(item.status) || !item.file_ref?.trim())
    )
      gaps.push(`${item.kind.replace(/_/g, " ")} from ${item.source_party}: stored file needed`);
  return gaps;
}
const ascii = (s: string) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e\n]/g, "?");
export async function buildSubmittalPdf(
  ctx: PackageContext,
  files: PackageFile[],
  logo?: Uint8Array,
) {
  const gaps = packageGaps(ctx);
  if (gaps.length) throw new Error(gaps.join("; "));
  if (
    !files.length ||
    files.length > 40 ||
    files.reduce((n, f) => n + f.bytes.length, 0) > PACKAGE_MAX_BYTES
  )
    throw new Error("A package needs 1 to 40 files totaling at most 50 MB.");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.118, 0.227, 0.373),
    blue = rgb(30 / 255, 95 / 255, 237 / 255),
    gray = rgb(0.42, 0.45, 0.5);
  let page = doc.addPage([612, 792]),
    y = 750;
  function line(value: string, size = 11, heavy = false, color = navy) {
    const words = ascii(value).split(/\s+/);
    let text = "";
    const measuredFont = heavy ? bold : font;
    const boundedWords = words.flatMap((word) => {
      const chunks: string[] = [];
      let chunk = "";
      for (const character of word) {
        if (chunk && measuredFont.widthOfTextAtSize(chunk + character, size) > 510) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += character;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
    for (const word of boundedWords) {
      if (measuredFont.widthOfTextAtSize(`${text} ${word}`, size) > 510 && text) {
        draw(text);
        text = "";
      }
      text += (text ? " " : "") + word;
    }
    if (text) draw(text);
    function draw(text: string) {
      if (y < 55) {
        page = doc.addPage([612, 792]);
        y = 745;
      }
      page.drawText(text, { x: 48, y, size, font: heavy ? bold : font, color });
      y -= size + 7;
    }
  }
  if (logo) {
    const image = logo[0] === 137 ? await doc.embedPng(logo) : await doc.embedJpg(logo);
    const fit = image.scaleToFit(145, 45);
    page.drawImage(image, { x: 420, y: 735, width: fit.width, height: fit.height });
  }
  line(ctx.brand.name, 20, true);
  line(
    [
      ctx.brand.contact_phone,
      ctx.brand.website,
      ctx.brand.license_number ? `License ${ctx.brand.license_number}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    9,
    false,
    gray,
  );
  y -= 10;
  page.drawRectangle({ x: 48, y, width: 516, height: 3, color: blue });
  y -= 30;
  line("SUBMITTAL TRANSMITTAL", 17, true);
  line(`T-${ctx.transmittal_number} | ${ctx.today}`, 12, true, blue);
  line(`Job ${ctx.job_number} - ${ctx.job_name}`);
  line(`Submittal ${ctx.submittal.number} | Revision ${ctx.submittal.revision}`);
  line(ctx.submittal.title, 13, true);
  line(`Required by spec section ${ctx.submittal.spec_section}`);
  y -= 12;
  line("ITEMS INCLUDED", 12, true);
  const manifest: {
    item_id: string | undefined;
    name: string;
    source_party: string;
    kind: string;
    pages: number;
    embedded: boolean;
    file_ref: string | null;
    sha256: string;
  }[] = [];
  // Reserve covers first; append sources only after all cover pages are laid out.
  for (const file of files) {
    const ext = file.name.split(".").at(-1)?.toLowerCase();
    const embedded = !["pdf", "png", "jpg", "jpeg"].includes(ext ?? "");
    line(`${file.item.kind.replace(/_/g, " ")} - ${file.item.source_party}`, 11, true);
    line(
      `${file.name}${embedded ? " (native document in PDF attachments panel)" : ""}`,
      10,
      false,
      gray,
    );
    manifest.push({
      item_id: file.item.id ?? undefined,
      name: file.name,
      source_party: file.item.source_party,
      kind: file.item.kind,
      pages: 0,
      embedded,
      file_ref: file.item.file_ref ?? null,
      sha256: await sha256Hex(file.bytes),
    });
  }
  y -= 10;
  line(
    "For review. Please reference the submittal, revision and transmittal numbers in your response.",
    10,
    false,
    gray,
  );
  line(
    "Source originals are included in PDF attachments; PDF and image pages also follow this cover.",
    10,
    false,
    gray,
  );
  const coverPages = doc.getPageCount();
  for (let i = 0; i < files.length; i++) {
    const file = files[i],
      ext = file.name.split(".").at(-1)?.toLowerCase();
    if (ext === "pdf") {
      let source: PDFDocument;
      try {
        source = await PDFDocument.load(file.bytes);
      } catch {
        throw new Error(`Cannot read ${file.name}; provide an unlocked, valid PDF.`);
      }
      if (source.getPageCount() + doc.getPageCount() > 500)
        throw new Error("A package may contain at most 500 pages.");
      const pages = await doc.copyPages(source, source.getPageIndices());
      if (!pages.length) throw new Error(`${file.name} has no pages.`);
      pages.forEach((p) => doc.addPage(p));
      manifest[i].pages = pages.length;
    } else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
      const image = ext === "png" ? await doc.embedPng(file.bytes) : await doc.embedJpg(file.bytes);
      const p = doc.addPage([612, 792]),
        fit = image.scaleToFit(516, 696);
      p.drawImage(image, {
        x: (612 - fit.width) / 2,
        y: (792 - fit.height) / 2,
        width: fit.width,
        height: fit.height,
      });
      manifest[i].pages = 1;
    } else if (["docx", "xlsx", "csv"].includes(ext ?? "")) {
      await doc.attach(file.bytes, `${i + 1}-${file.name}`, {
        description: `${file.item.kind}: ${file.item.source_party}`,
      });
    } else
      throw new Error(
        `Unsupported package file: ${file.name}. Use PDF, PNG, JPEG, DOCX, XLSX or CSV.`,
      );
    if (!manifest[i].embedded)
      await doc.attach(file.bytes, `Original-${i + 1}-${file.name}`, {
        description: `Unchanged source from ${file.item.source_party}`,
      });
    if (doc.getPageCount() > 500) throw new Error("A package may contain at most 500 pages.");
  }
  const bytes = await doc.save();
  if (bytes.length > PACKAGE_MAX_BYTES) throw new Error("The combined package is over 50 MB.");
  return { bytes, pageCount: doc.getPageCount(), coverPages, manifest };
}
