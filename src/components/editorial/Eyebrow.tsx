import React from "react";
import { cn } from "@/lib/utils";

interface EyebrowProps {
  children: React.ReactNode;
  accent?: boolean;
  bare?: boolean;
  className?: string;
  as?: "div" | "span" | "p";
}

/**
 * DDB/Ogilvy-style tracked uppercase eyebrow with a leading hairline rule.
 * Used inside the handbook reader (`.handbook-scope`). The `.eyebrow*`
 * classes are defined in `src/styles/handbook.css`.
 */
const Eyebrow: React.FC<EyebrowProps> = ({
  children,
  accent = false,
  bare = false,
  className,
  as: Component = "div",
}) => {
  return (
    <Component
      className={cn(
        "eyebrow",
        accent && "eyebrow--accent",
        bare && "eyebrow--bare",
        className,
      )}
    >
      {children}
    </Component>
  );
};

export default Eyebrow;
