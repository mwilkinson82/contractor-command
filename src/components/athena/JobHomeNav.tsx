import { Fragment, type ReactNode } from "react";

/** One link in a job board menu group. `node` replaces the plain link (the Notifications entry draws its own). */
export type JobNavLink = {
  key: string;
  label: string;
  href: string;
  current?: boolean;
  node?: ReactNode;
};
export type JobNavGroup = { id: string; title: string; links: JobNavLink[] };

/** Below this width the menu is a row of group buttons and an open group drops its links under the row. */
const PHONE = "(max-width: 760px)";

/**
 * The job board's left menu: every board link, sorted into groups that open on click. Groups use native
 * details/summary, so they work before the page script loads and need no saved state. One group is open at a time.
 */
export function JobHomeNav({ groups }: { groups: JobNavGroup[] }) {
  const shown = groups.filter((g) => g.links.length > 0);
  return (
    <div className="jh-navwrap">
      <nav
        className="jh-nav jh-nav-groups"
        aria-label="Project views"
        onClick={(event) => {
          // On a phone an open group covers the page, so close it once a same-page link is chosen.
          const link = (event.target as HTMLElement).closest("a");
          if (!link || !(link.getAttribute("href") ?? "").startsWith("#")) return;
          if (typeof window !== "undefined" && window.matchMedia?.(PHONE).matches)
            link.closest("details")?.removeAttribute("open");
        }}
      >
        {shown.map((g) => (
          <details key={g.id} className="jh-group" {...{ name: "jh-nav-group" }}>
            <summary>
              <span>{g.title}</span>
              <svg className="jh-chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </summary>
            <div className="jh-group-links">
              {g.links.map((l) =>
                l.node !== undefined ? (
                  <Fragment key={l.key}>{l.node}</Fragment>
                ) : (
                  <a key={l.key} href={l.href} aria-current={l.current ? "page" : undefined}>
                    {l.label}
                  </a>
                ),
              )}
            </div>
          </details>
        ))}
      </nav>
    </div>
  );
}
