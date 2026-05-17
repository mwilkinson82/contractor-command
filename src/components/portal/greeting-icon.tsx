import { Hand, Hammer, Scale, BrickWall } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SVGProps } from "react";

// Simple inline SVGs for icons not in lucide (crane, bulldozer).
function CraneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* mast */}
      <path d="M5 21V4" />
      {/* horizontal jib */}
      <path d="M5 6h14" />
      {/* counter jib */}
      <path d="M5 6L2 9" />
      {/* hoist cable + hook */}
      <path d="M15 6v5" />
      <path d="M14 11h2v2h-2z" />
      {/* base */}
      <path d="M3 21h6" />
    </svg>
  );
}

function BulldozerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* cab */}
      <path d="M8 12V8h5l2 4" />
      {/* body */}
      <path d="M6 16h12v-4H6z" />
      {/* blade */}
      <path d="M3 17V9" />
      <path d="M3 17l3-1" />
      {/* tracks */}
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export type GreetingIconKey =
  | "wave"
  | "crane"
  | "bulldozer"
  | "hammer"
  | "scale"
  | "brick";

type IconComp = LucideIcon | ((p: SVGProps<SVGSVGElement>) => JSX.Element);

export const GREETING_ICONS: {
  key: GreetingIconKey;
  label: string;
  Icon: IconComp;
}[] = [
  { key: "wave", label: "Wave", Icon: Hand },
  { key: "crane", label: "Crane", Icon: CraneIcon },
  { key: "bulldozer", label: "Bulldozer", Icon: BulldozerIcon },
  { key: "hammer", label: "Hammer", Icon: Hammer },
  { key: "scale", label: "Scale", Icon: Scale },
  { key: "brick", label: "Brick", Icon: BrickWall },
];

export function GreetingIcon({
  iconKey,
  className,
}: {
  iconKey: GreetingIconKey | null | undefined;
  className?: string;
}) {
  if (!iconKey) return null;
  const entry = GREETING_ICONS.find((g) => g.key === iconKey);
  if (!entry) return null;
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden />;
}
