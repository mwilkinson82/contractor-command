import { Link } from "@tanstack/react-router";
import ccMark from "@/assets/cc-mark.png";
import bulldozer from "@/assets/bulldozer.png";

/**
 * Shared shell for the public auth screens (login, signup, welcome,
 * forgot-password, reset-password). Keeps the cream card + DDB
 * advertisement on the right consistent across the flow.
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
    <div className="relative grid min-h-screen w-full grid-cols-1 bg-paper-edge/60 p-6 text-ink font-sans selection:bg-ink selection:text-cream md:grid-cols-2 md:items-center lg:p-10">
      {/* Left: card */}
      <div className="flex justify-center md:justify-end md:pr-10 lg:pr-16">
        <div className="w-full max-w-[440px]">
          <div className="rounded-[28px] bg-cream shadow-[0_30px_80px_-40px_rgba(20,16,12,0.35),0_2px_0_rgba(20,16,12,0.04)] ring-1 ring-ink/[0.06]">
            <div className="px-10 pt-10 pb-9">
              <Link to="/" className="inline-flex items-center gap-3" aria-label="Contractor Circle">
                <img src={ccMark} alt="" className="h-12 w-12 object-contain" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-ink/45">
                  ALP &middot; Contractor Circle
                </span>
              </Link>

              <h1 className="mt-8 font-display text-[44px] leading-[1.0] -tracking-[0.01em]">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 text-[13px] leading-relaxed text-ink/55">{subtitle}</p>
              )}

              <div className="mt-8">{children}</div>
            </div>

            <div className="border-t border-ink/[0.06] px-10 py-4 text-center">
              <span className="text-[10px] uppercase tracking-[0.28em] text-ink/35">
                {footer ?? "Members only"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: advertisement */}
      <div className="relative hidden md:flex md:justify-start md:pl-10 lg:pl-16">
        <div className="w-full max-w-[520px]">
          <img
            src={bulldozer}
            alt=""
            className="mb-8 block w-full max-w-[460px] select-none object-contain mix-blend-multiply"
            draggable={false}
          />
          <h2 className="font-display text-[96px] leading-[0.92] -tracking-[0.025em] text-ink lg:text-[112px]">
            Boring<br />wins.
          </h2>

          <div className="mt-10 grid grid-cols-3 gap-5 text-[11.5px] leading-[1.55] text-ink/75 [text-align:justify] [hyphens:auto] [text-justify:inter-word] tracking-[-0.005em]">
            <p>
              The best contractors we know aren't the loudest ones. They're the
              ones with systems. The ones who go home at five. The ones whose
              crews know what to do Monday morning without being told twice.
            </p>
            <p>
              That's what this is. Not another app. An operating system for the
              company behind your projects&mdash;meetings that end, numbers
              that mean something, a team that runs without you in the room.
            </p>
            <p>
              It isn't flashy. There's no dashboard with a rocket on it.
              Just a quiet, repeatable way to run a real construction business.
              <br /><br />
              Boring, maybe. But boring is what scales.
            </p>
          </div>

          <div className="mt-10 text-[10px] uppercase tracking-[0.28em] text-ink/35">
            $2.5 Billion in Construction
          </div>
        </div>
      </div>
    </div>
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
      <label htmlFor={id} className="block text-[10px] uppercase tracking-[0.22em] text-ink/50">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className="mt-2 w-full border-0 border-b border-ink/15 bg-transparent px-0 py-2.5 text-[15px] outline-none transition-colors placeholder:text-ink/25 focus:border-ink"
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
      className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {busy ? (busyLabel ?? "Working") : label}
    </button>
  );
}
