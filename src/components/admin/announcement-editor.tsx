import { useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  Bold,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_MARKDOWN_ELEMENTS,
  announcementUrlTransform,
} from "@/lib/announcement-markdown";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PREVIEW_MARKDOWN_COMPONENTS: Components = {
  h2: ({ children }) => <h2 className="mb-3 mt-6 font-display text-2xl first:mt-0">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-clay underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ src, alt }) =>
    src ? (
      <img
        src={src}
        alt={alt ?? ""}
        className="my-5 h-auto max-w-full rounded-lg border border-border"
      />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-signal pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
};

interface AnnouncementEditorProps {
  value: string;
  onChange: (value: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  maxLength?: number;
}

export function AnnouncementEditor({
  value,
  onChange,
  onUploadImage,
  maxLength = 20_000,
}: AnnouncementEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [showMedia, setShowMedia] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");

  const replaceSelection = (
    replacement: string,
    selectionStartOffset = replacement.length,
    selectionLength = 0,
  ) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      const selectionStart = start + selectionStartOffset;
      textarea?.setSelectionRange(selectionStart, selectionStart + selectionLength);
    });
  };

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    replaceSelection(`${before}${selected}${after}`, before.length, selected.length);
  };

  const prefixLines = (prefix: string, fallback: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const formatted = selected
      .split("\n")
      .map((line, index) => `${prefix === "1. " ? `${index + 1}. ` : prefix}${line}`)
      .join("\n");
    replaceSelection(formatted, 0, formatted.length);
  };

  const insertImage = (url: string, alt: string) => {
    const safeAlt = alt.replaceAll("[", "").replaceAll("]", "").trim() || "Announcement image";
    replaceSelection(`\n\n![${safeAlt}](${url})\n\n`);
    setImageUrl("");
    setImageAlt("");
    setMediaError("");
    setShowMedia(false);
  };

  const insertImageUrl = () => {
    try {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== "https:") throw new Error("Use an HTTPS image URL.");
      insertImage(parsed.toString(), imageAlt);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Enter a valid HTTPS image URL.");
    }
  };

  const uploadImage = async (file: File) => {
    if (!IMAGE_TYPES.has(file.type)) {
      setMediaError("Use a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMediaError("Images and GIFs must be 8 MB or smaller.");
      return;
    }

    setUploading(true);
    setMediaError("");
    try {
      const publicUrl = await onUploadImage(file);
      const fallbackAlt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      insertImage(publicUrl, imageAlt || fallbackAlt);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/25 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1" aria-label="Message formatting toolbar">
          <ToolbarButton label="Bold" onClick={() => wrapSelection("**", "**", "bold text")}>
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Italic" onClick={() => wrapSelection("*", "*", "italic text")}>
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Heading" onClick={() => prefixLines("## ", "Section heading")}>
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Bulleted list" onClick={() => prefixLines("- ", "List item")}>
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Numbered list" onClick={() => prefixLines("1. ", "List item")}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="Link"
            onClick={() => wrapSelection("[", "](https://example.com)", "link text")}
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label="Image or GIF"
            pressed={showMedia}
            onClick={() => {
              setMode("write");
              setShowMedia((current) => !current);
              setMediaError("");
            }}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>

        <div className="flex rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setMode("write")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "write" ? "bg-ink text-cream" : "text-muted-foreground hover:text-foreground"}`}
            aria-pressed={mode === "write"}
          >
            <PenLine className="h-3 w-3" /> Write
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${mode === "preview" ? "bg-ink text-cream" : "text-muted-foreground hover:text-foreground"}`}
            aria-pressed={mode === "preview"}
          >
            <Eye className="h-3 w-3" /> Preview
          </button>
        </div>
      </div>

      {showMedia ? (
        <div className="border-b border-border bg-background px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <Input
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
              placeholder="Image description"
              aria-label="Image description"
              maxLength={140}
            />
            <Input
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https:// image or GIF URL"
              aria-label="Image or GIF URL"
            />
            <Button type="button" variant="outline" onClick={insertImageUrl} disabled={!imageUrl}>
              Insert URL
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="mr-2 h-3.5 w-3.5" />
              )}
              Upload image or GIF
            </Button>
            <span className="text-[11px] text-muted-foreground">
              PNG, JPEG, WebP, or GIF · up to 8 MB
            </span>
          </div>
          {mediaError ? <p className="mt-2 text-[12px] text-destructive">{mediaError}</p> : null}
        </div>
      ) : null}

      {mode === "write" ? (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={16}
          maxLength={maxLength}
          className="min-h-[360px] resize-y rounded-none border-0 bg-background px-4 py-4 font-sans text-[14px] leading-relaxed focus-visible:ring-0"
          placeholder="Write the announcement here…"
        />
      ) : (
        <div className="min-h-[360px] bg-background px-6 py-6">
          {value.trim() ? (
            <div className="announcement-preview text-[14px] leading-relaxed text-foreground">
              <ReactMarkdown
                allowedElements={ANNOUNCEMENT_MARKDOWN_ELEMENTS}
                unwrapDisallowed
                urlTransform={announcementUrlTransform}
                components={PREVIEW_MARKDOWN_COMPONENTS}
              >
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your formatted message preview will appear here.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
        <span>Bold, italic, headings, lists, links, images, and animated GIFs are supported.</span>
        <span className="font-mono">
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] transition-colors ${pressed ? "bg-ink text-cream" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
