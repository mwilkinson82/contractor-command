// Client-side text extractor for the Contract Readiness Scan upload.
// Supports .txt / .md (FileReader) and .pdf (pdfjs-dist).

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type.startsWith("text/") ||
    file.type === ""
  ) {
    return file.text();
  }
  throw new Error(
    "Unsupported file. Upload a PDF or paste text. (.txt and .md also work.)",
  );
}

async function extractPdf(file: File): Promise<string> {
  // Lazy import so pdfjs only loads when actually used.
  const pdfjs = await import("pdfjs-dist");
  // @ts-expect-error — Vite resolves the worker URL at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // @ts-expect-error TextItem.str exists on text items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(pageText);
  }
  return parts.join("\n\n").replace(/[ \t]+/g, " ").trim();
}
