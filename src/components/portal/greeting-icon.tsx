// Greeting icons — native color emoji. They render with the OS's full-color
// emoji font (Apple Color Emoji on macOS/iOS, Segoe UI Emoji on Windows,
// Noto Color Emoji on Android/Linux) so we get the friendly, recognizable
// "👋 hey, good morning" look with zero asset weight and no extra deps.
import type { CSSProperties } from "react";

export type GreetingIconKey =
  | "wave"
  | "crane"
  | "bulldozer"
  | "hammer"
  | "scale"
  | "brick";

const EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", "Android Emoji", sans-serif';

type Entry = {
  key: GreetingIconKey;
  label: string;
  emoji: string;
};

const ENTRIES: Entry[] = [
  { key: "wave", label: "Wave", emoji: "👋" },
  { key: "crane", label: "Crane", emoji: "🏗️" },
  { key: "bulldozer", label: "Bulldozer", emoji: "🚜" },
  { key: "hammer", label: "Hammer", emoji: "🔨" },
  { key: "scale", label: "Scale", emoji: "⚖️" },
  { key: "brick", label: "Brick", emoji: "🧱" },
];

function EmojiIcon({
  emoji,
  className,
  style,
}: {
  emoji: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="img"
      aria-hidden
      className={className}
      style={{
        fontFamily: EMOJI_FONT_STACK,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {emoji}
    </span>
  );
}

// Public list used by the onboarding/account icon pickers.
// `Icon` is a render-component compatible with the prior lucide-style API:
// it accepts `className` and renders the colored emoji at the inherited font-size.
export const GREETING_ICONS: {
  key: GreetingIconKey;
  label: string;
  Icon: (props: { className?: string }) => React.ReactElement;
}[] = ENTRIES.map(({ key, label, emoji }) => ({
  key,
  label,
  Icon: ({ className }: { className?: string }) => (
    <EmojiIcon emoji={emoji} className={className} />
  ),
}));

export function GreetingIcon({
  iconKey,
  className,
}: {
  iconKey: GreetingIconKey | null | undefined;
  className?: string;
}) {
  if (!iconKey) return null;
  const entry = ENTRIES.find((g) => g.key === iconKey);
  if (!entry) return null;
  return <EmojiIcon emoji={entry.emoji} className={className} />;
}
