import { contractorCircleBrand } from "@/lib/contractor-circle-brand";
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
    <span className={cn("inline-flex min-w-0 flex-col gap-1.5", className)}>
      <img
        src={
          compact
            ? inverse
              ? contractorCircleBrand.webMarkInverse
              : contractorCircleBrand.webMark
            : inverse
              ? contractorCircleBrand.webCompactInverse
              : contractorCircleBrand.webCompact
        }
        alt="Contractor Circle"
        className={cn(
          compact ? "h-9 w-9 object-contain" : "w-[180px] max-w-full h-auto",
          compact && markClassName,
        )}
      />
      {!compact && (
        <span
          className={cn(
            "font-mono text-[8px] font-semibold uppercase tracking-[0.2em]",
            inverse ? "text-cream/55" : "text-muted-foreground",
          )}
        >
          {context}
        </span>
      )}
    </span>
  );
}
