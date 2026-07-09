import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Control radius is a deliberate 11px (design system §5) — tighter than the
  // 20px card radius, so buttons read as precise instruments, not soft pills.
  // transition-all (not transition-colors) so the hover-lift on filled variants
  // actually animates.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[11px] text-sm font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The dark ink primary — the default filled control (design system §5 .btn-dark).
        default: "bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-px",
        // THE orange CTA. One per view. Signature glow shadow + hover-lift (§5 .btn-primary).
        signal:
          "bg-signal text-white shadow-[0_8px_20px_-8px_rgb(247_106_22_/_0.6)] hover:bg-signal/90 hover:-translate-y-px",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:-translate-y-px",
        // Outline hover darkens the hairline to ink — it does NOT spend orange (§5 .btn-outline).
        outline:
          "border-[1.5px] border-input bg-background hover:border-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        // Neutral hover fill — no faint-orange accent tint on every ghost/icon button.
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
