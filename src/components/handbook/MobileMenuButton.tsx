import { Menu } from "lucide-react";
import { useAppSidebar } from "@/components/portal/app-sidebar";

/**
 * Floating mobile-only menu button for the handbook reader.
 * The handbook hides the standard portal chrome behind its full-bleed
 * reading surface, so on phones there's no obvious way back to the
 * sidebar. This button pins to the top-left and opens the sidebar
 * drawer — same affordance as the TopStrip hamburger.
 */
export function HandbookMobileMenu() {
  const { toggleMobile } = useAppSidebar();
  return (
    <button
      type="button"
      onClick={toggleMobile}
      aria-label="Open menu"
      className="fixed top-3 left-3 z-50 grid h-10 w-10 place-items-center rounded-full bg-ink text-cream shadow-lg ring-1 ring-black/10 transition-transform hover:scale-105 md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}
