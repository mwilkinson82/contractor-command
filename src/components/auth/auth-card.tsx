import { Link } from "@tanstack/react-router";
import ccMark from "@/assets/cc-mark.png";
import bulldozer from "@/assets/bulldozer.png";

/**
 * Shared shell for the public auth screens (login, signup, welcome,
 * forgot-password, reset-password). Keeps the cream card + DDB
 * advertisement consistent across the flow.
 *
 * Layout:
 *  - mobile: card first, advertisement stacks beneath it
 *  - md+:    card left, advertisement right, both centered vertically
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
    <div className="relative min-h-screen w-full bg-paper-edge/60 px-4 py-8 text-ink font-sans selection:bg-ink selection:text-cream sm:px-6 md:grid md:grid-cols-2 md:items-center md:gap-6 md:px-6 md:py-6 lg:p-10">
      {/* Card */}
      <div className="flex justify-center md:justify-end md:pr-6 lg:pr-16">
        <div className="auth-rise w-full max-w-[440px]">
          <div className="rounded-[24px] bg-cream shadow-[0_30px_80px_-40px_rgba(20,16,12,0.35),0_2px_0_rgba(20,16,12,0.04)] ring-1 ring-ink/[0.06] transition-shadow duration-500 hover:shadow-[0_40px_100px_-40px_rgba(20,16,12,0.45),0_2px_0_rgba(20,16,12,0.05)] sm:rounded-[28px]">
            <div className="px-6 pt-8 pb-7 sm:px-10 sm:pt-10 sm:pb-9">
              <Link
                to="/"
                className="inline-flex items-center gap-3 transition-opacity hover:opacity-80"
                aria-label="Contractor Circle"
              >
                <img src={ccMark} alt="" className="h-11 w-11 object-contain sm:h-12 sm:w-12" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-ink/45">
                  ALP &middot; Contractor Circle
                </span>
              </Link>

              <h1 className="mt-7 font-display text-[36px] leading-[1.0] -tracking-[0.01em] sm:mt-8 sm:text-[44px]">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 text-[13px] leading-relaxed text-ink/55">{subtitle}</p>
              )}

              <div className="mt-7 sm:mt-8">{children}</div>
            </div>

            <div className="border-t border-ink/[0.06] px-6 py-4 text-center sm:px-10">
              <span className="text-[10px] uppercase tracking-[0.28em] text-ink/35">
                {footer ?? "Members only"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Advertisement — stacks below card on mobile, sits to the right on md+ */}
      <div className="mt-12 flex justify-center md:mt-0 md:justify-start md:pl-6 lg:pl-16">
        <div className="w-full max-w-[520px]">
          <img
            src={bulldozer}
            alt=""
            className="auth-rise auth-rise-delay-1 mb-6 block w-full max-w-[380px] select-none object-contain mix-blend-multiply sm:mb-8 md:max-w-[460px]"
            draggable={false}
          />
          <h2 className="auth-rise auth-rise-delay-2 font-display text-[64px] leading-[0.92] -tracking-[0.025em] text-ink sm:text-[80px] md:text-[96px] lg:text-[112px]">
            Boring<br />wins.
          </h2>

          <div className="auth-rise auth-rise-delay-3 mt-8 grid grid-cols-1 gap-5 text-[12px] leading-[1.55] text-ink/75 [text-align:justify] [hyphens:auto] [text-justify:inter-word] tracking-[-0.005em] sm:grid-cols-3 sm:text-[11.5px] md:mt-10">
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

          <div className="auth-rise auth-rise-delay-3 mt-8 text-[10px] uppercase tracking-[0.28em] text-ink/35 md:mt-10">
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
        className="mt-2 w-full border-0 border-b border-ink/15 bg-transparent px-0 py-2.5 text-[16px] outline-none transition-colors duration-300 placeholder:text-ink/25 hover:border-ink/40 focus:border-ink sm:text-[15px]"
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
      className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[13px] uppercase tracking-[0.22em] text-cream transition-all duration-300 hover:-translate-y-px hover:shadow-[0_12px_30px_-12px_rgba(20,16,12,0.5)] active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {busy ? (busyLabel ?? "Working") : label}
    </button>
  );
}
