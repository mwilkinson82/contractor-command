import { cn } from "@/lib/utils";

interface ContractorCircleBrandProps {
  context?: string;
  className?: string;
  markClassName?: string;
  inverse?: boolean;
  compact?: boolean;
}

export function ContractorCircleBrand({
  context = "Command Center",
  className,
  markClassName,
  inverse = false,
  compact = false,
}: ContractorCircleBrandProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <img
        src="/brand/contractor-circle-mark.png"
        alt=""
        aria-hidden="true"
        className={cn("h-9 w-9 shrink-0 object-contain", markClassName)}
      />
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <strong
            className={cn(
              "truncate font-display text-[14px] font-semibold tracking-tight",
              inverse ? "text-cream" : "text-foreground",
            )}
          >
            Contractor Circle
          </strong>
          <span
            className={cn(
              "mt-0.5 truncate font-mono text-[8px] font-semibold uppercase tracking-[0.2em]",
              inverse ? "text-cream/55" : "text-muted-foreground",
            )}
          >
            {context}
          </span>
        </span>
      )}
    </span>
  );
}
