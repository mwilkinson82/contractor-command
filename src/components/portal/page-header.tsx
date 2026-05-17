import { type ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 border-b border-border/70 pb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="label-mono">{eyebrow}</p> : null}
        <h1 className="mt-3 font-display text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {lede ? <p className="mt-4 text-base text-muted-foreground sm:text-lg">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1180px] px-6 py-12 sm:py-16 ${className}`}>{children}</div>;
}
