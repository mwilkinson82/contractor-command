import { Link } from "@tanstack/react-router";
import { ContractorCircleBrand } from "@/components/brand/contractor-circle-brand";

const GATEWAY_SECTIONS = [
  {
    title: "Command Center",
    detail: "Start Here · announcements · State of Control",
  },
  {
    title: "Learn & Install",
    detail: "Handbook · Contractor OS · replays · templates",
  },
  {
    title: "Run the Work",
    detail: "AOS · OverWatch · tools · Vault",
  },
  {
    title: "Work the Room",
    detail: "Calls · Discord · Ask Marshall · community",
  },
] as const;

/**
 * Shared public shell for every authentication state. The Hub is the command
 * center for the complete ALP operating system, so this shell orients the user
 * before entitlement routing decides what they can open.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-5 text-foreground sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1450px]">
        <header className="flex items-center justify-between border-b border-border pb-4">
          <Link to="/" aria-label="Contractor Circle Command Center">
            <ContractorCircleBrand markClassName="h-10 w-10" />
          </Link>
          <span className="hidden font-display text-[21px] text-foreground sm:block">
            The Contractor Circle Hub
          </span>
        </header>

        <section className="relative mt-5 overflow-hidden rounded-2xl border border-border bg-[var(--paper-deep)] shadow-[var(--shadow-soft)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(90deg,transparent_49.8%,var(--border)_50%,transparent_50.2%),linear-gradient(transparent_49.8%,var(--border)_50%,transparent_50.2%)] [background-size:120px_120px]"
          />

          <div className="relative grid min-h-[650px] gap-8 p-4 sm:p-7 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:gap-12 lg:p-12 xl:px-16">
            <div className="px-2 py-8 sm:px-5 lg:py-10">
              <p className="eyebrow-clay">The Contractor Circle Hub</p>
              <h1 className="mt-5 max-w-[700px] font-display text-[48px] leading-[0.98] tracking-[-0.035em] sm:text-[62px] xl:text-[72px]">
                One login. The whole operating system.
              </h1>
              <p className="mt-6 max-w-[650px] text-[14px] leading-7 text-muted-foreground sm:text-[15px]">
                The Hub is the command center for the entire system—method, applications, tools,
                templates, announcements, and community in one place.
              </p>

              <div className="mt-8 grid max-w-[660px] gap-2.5 sm:grid-cols-2">
                {GATEWAY_SECTIONS.map((section) => (
                  <article
                    key={section.title}
                    className="rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm"
                  >
                    <h2 className="font-display text-[18px] leading-tight">{section.title}</h2>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                      {section.detail}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <section className="rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-elegant)] sm:p-9">
              <div className="flex items-start justify-between gap-4">
                <p className="eyebrow-clay">Contractor Circle Hub</p>
                <a
                  href="mailto:support@alpcontractorcircle.com"
                  className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-clay hover:underline"
                >
                  Need help?
                </a>
              </div>

              <h2 className="mt-4 font-display text-[36px] leading-[1.03] tracking-[-0.02em]">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
              )}

              <div className="mt-8">{children}</div>

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>{footer ?? "Command center"}</span>
                <span>an ALP product</span>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

export function AuthField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className="mt-2 h-11 w-full rounded-lg border border-border bg-card px-3.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-clay focus:ring-2 focus:ring-clay/15"
      />
      {hint && <div className="mt-2">{hint}</div>}
    </div>
  );
}

export function AuthSubmit({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg bg-signal px-5 text-[13px] font-semibold text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? (busyLabel ?? "Working") : `${label} →`}
    </button>
  );
}
