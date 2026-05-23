import { useEffect, useRef, useState } from "react";

interface InlineTextProps {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  placeholder?: string;
}

/**
 * Click-to-edit text field. Enter commits, Escape cancels, blur commits.
 * Renders as a plain span until activated, so the table layout is unchanged.
 */
export function InlineText({ value, onCommit, className, placeholder }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      // focus after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value]);

  if (!editing) {
    return (
      <span
        className={`block cursor-text truncate rounded-sm px-0.5 hover:bg-[#fef3d2]/50 ${className ?? ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        title={value || placeholder}
      >
        {value || (
          <span className="text-[#c7b89d] italic">{placeholder ?? "—"}</span>
        )}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          if (draft !== value) onCommit(draft);
          setEditing(false);
        } else if (e.key === "Escape") {
          setEditing(false);
        }
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
        setEditing(false);
      }}
      className={`w-full rounded-sm border border-[#5b8bd6] bg-white px-1 py-0 outline-none ring-2 ring-[#5b8bd6]/20 ${className ?? ""}`}
    />
  );
}

interface InlineNumberProps {
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}

export function InlineNumber({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  className,
}: InlineNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(value));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      let next = n;
      if (min != null) next = Math.max(min, next);
      if (max != null) next = Math.min(max, next);
      if (next !== value) onCommit(next);
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        className={`block cursor-text rounded-sm px-0.5 text-right tabular-nums hover:bg-[#fef3d2]/50 ${className ?? ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {value}
        {suffix}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      value={draft}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(false);
      }}
      onBlur={commit}
      className={`w-full rounded-sm border border-[#5b8bd6] bg-white px-1 py-0 text-right tabular-nums outline-none ring-2 ring-[#5b8bd6]/20 ${className ?? ""}`}
    />
  );
}
