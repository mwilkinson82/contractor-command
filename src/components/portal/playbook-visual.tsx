import type { ReactNode } from "react";

export type PlaybookVisualId =
  | "system-map"
  | "constraint-plan"
  | "doctrine-project"
  | "doctrine-capacity"
  | "doctrine-budget"
  | "doctrine-risk"
  | "owner-bottleneck"
  | "control-levels"
  | "economics-engine"
  | "ior-formula"
  | "field-control"
  | "risk-action"
  | "weekly-rhythm"
  | "delivery-systems";

export function PlaybookVisual({
  id,
  className = "",
}: {
  id: PlaybookVisualId;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden bg-[#faf9f5] text-[#1f1e1b] ${className}`}
      style={{ containerType: "inline-size" }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(217,119,87,0.06),transparent_36%),radial-gradient(circle_at_78%_18%,rgba(217,119,87,0.08),transparent_22%)]" />
      <div className="absolute inset-[2.2cqw] border border-[#d8d4c8]" />
      <div className="absolute left-[4.4cqw] right-[4.4cqw] top-[3.7cqw] flex items-center justify-between border-b border-[#d8d4c8] pb-[1cqw] font-mono text-[0.72cqw] uppercase tracking-[0.22em] text-[#76736b]">
        <span>ALP Contractor Circle</span>
        <span className="text-[#c36e4f]">Professional Contractor Control</span>
      </div>
      <div className="absolute inset-x-[4.4cqw] bottom-[3.7cqw] flex items-center justify-between border-t border-[#d8d4c8] pt-[1cqw] font-mono text-[0.68cqw] uppercase tracking-[0.2em] text-[#76736b]">
        <span>Teach top-down · Install bottom-up</span>
        <span>Build · Lead · Profit</span>
      </div>
      <div className="absolute inset-x-[5.2cqw] bottom-[7.2cqw] top-[7cqw]">{renderVisual(id)}</div>
    </div>
  );
}

function renderVisual(id: PlaybookVisualId) {
  switch (id) {
    case "system-map":
      return <SystemMap />;
    case "constraint-plan":
      return <ConstraintPlan />;
    case "doctrine-project":
      return (
        <Doctrine
          number="01"
          title="The project is not the business."
          copy="The company is the machine that repeatedly finds, sells, staffs, finances, controls, and completes projects."
          sequence={["Company machine", "Repeatable delivery", "Profitable projects"]}
        />
      );
    case "doctrine-capacity":
      return (
        <Doctrine
          number="02"
          title="The gap is capacity."
          copy="Revenue targets do not create throughput. People, cash, billing velocity, bonding, and operating bandwidth do."
          sequence={["Revenue target", "Capacity constraint", "Supportable growth"]}
        />
      );
    case "doctrine-budget":
      return (
        <Doctrine
          number="03"
          title="The budget is not truth."
          copy="The budget is the original plan. IOR is the current financial truth of where the project is indicating it will land."
          sequence={["Original plan", "Current risk", "Indicated outcome"]}
        />
      );
    case "doctrine-risk":
      return (
        <Doctrine
          number="04"
          title="Risk is the job."
          copy="Control comes from eliminating, recovering, offsetting, or consciously accepting risk while the outcome can still change."
          sequence={["See it", "Price it", "Act on it"]}
        />
      );
    case "owner-bottleneck":
      return <OwnerBottleneck />;
    case "control-levels":
      return <ControlLevels />;
    case "economics-engine":
      return <EconomicsEngine />;
    case "ior-formula":
      return <IorFormula />;
    case "field-control":
      return <FieldControl />;
    case "risk-action":
      return <RiskAction />;
    case "weekly-rhythm":
      return <WeeklyRhythm />;
    case "delivery-systems":
      return <DeliverySystems />;
  }
}

function VisualHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
}) {
  return (
    <div className="text-center">
      <p className="font-mono text-[0.78cqw] uppercase tracking-[0.24em] text-[#c36e4f]">
        {eyebrow}
      </p>
      <h3 className="mt-[0.7cqw] font-display text-[3.15cqw] leading-[0.98]">{title}</h3>
      {copy ? (
        <p className="mx-auto mt-[0.8cqw] max-w-[70cqw] text-[1.05cqw] leading-[1.35] text-[#76736b]">
          {copy}
        </p>
      ) : null}
    </div>
  );
}

function Arrow() {
  return <span className="font-mono text-[2cqw] text-[#d97757]">→</span>;
}

function DiagramCard({
  number,
  title,
  label,
  copy,
  accent = false,
}: {
  number?: string;
  title: string;
  label?: string;
  copy?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col justify-center rounded-[0.8cqw] border bg-white/75 px-[1.35cqw] py-[1.2cqw] ${accent ? "border-[#d97757]" : "border-[#d8d4c8]"}`}
    >
      {number || label ? (
        <p
          className={`font-mono text-[0.68cqw] uppercase tracking-[0.18em] ${accent ? "text-[#c36e4f]" : "text-[#76736b]"}`}
        >
          {number ? `[ ${number} ]` : label}
        </p>
      ) : null}
      <h4 className="mt-[0.45cqw] font-display text-[1.65cqw] leading-[1.02]">{title}</h4>
      {copy ? (
        <p className="mt-[0.55cqw] text-[0.8cqw] leading-[1.35] text-[#76736b]">{copy}</p>
      ) : null}
    </div>
  );
}

function SystemMap() {
  const steps = [
    ["01", "AOS", "Run the company"],
    ["02", "Economics", "Prove capacity"],
    ["03", "IOR", "Control projects"],
    ["04", "Field truth", "Measure daily"],
    ["05", "Weekly rhythm", "Turn red into action"],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="The operating map"
        title="One system. Three levels of control."
        copy="AOS creates company control. IOR creates project control. Daily Project WIP creates field control."
      />
      <div className="mt-[2.2cqw] flex items-stretch gap-[0.65cqw]">
        {steps.map(([number, title, copy], index) => (
          <div key={title} className="contents">
            <DiagramCard
              number={number}
              title={title}
              copy={copy}
              accent={title === "Field truth"}
            />
            {index < steps.length - 1 ? (
              <div className="flex items-center">
                <Arrow />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-[1.5cqw] rounded-full bg-[#1f1e1b] px-[3cqw] py-[0.8cqw] font-mono text-[0.78cqw] uppercase tracking-[0.2em] text-[#faf9f5]">
        See early · Act while the outcome can change · Confirm at month-end
      </div>
    </div>
  );
}

function ConstraintPlan() {
  const steps = [
    ["01", "Diagnose", "Measure the current state of control."],
    ["02", "Prioritize", "Name the constraint with the largest consequence."],
    ["03", "Install", "Assign the system, owner, cadence, and application."],
    ["04", "Prove", "Re-measure the signal and verify movement."],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="90-day implementation"
        title="Constraint Resolution Plan"
        copy="Do not install everything at once. Remove the constraint that most limits control, cash, or margin."
      />
      <div className="mt-[2.4cqw] flex items-stretch gap-[0.9cqw]">
        {steps.map(([number, title, copy], index) => (
          <div key={title} className="contents">
            <DiagramCard number={number} title={title} copy={copy} accent={index === 0} />
            {index < steps.length - 1 ? (
              <div className="flex items-center">
                <Arrow />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Doctrine({
  number,
  title,
  copy,
  sequence,
}: {
  number: string;
  title: string;
  copy: string;
  sequence: string[];
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading eyebrow={`Doctrine ${number}`} title={title} copy={copy} />
      <div className="mx-auto mt-[3cqw] flex w-[78cqw] items-center gap-[1.2cqw]">
        {sequence.map((item, index) => (
          <div key={item} className="contents">
            <DiagramCard
              number={String(index + 1).padStart(2, "0")}
              title={item}
              accent={index === sequence.length - 1}
            />
            {index < sequence.length - 1 ? <Arrow /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnerBottleneck() {
  const dependencies = [
    "Decisions",
    "Client context",
    "Financial judgment",
    "Risk interpretation",
    "Process memory",
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Company control"
        title="Remove the owner as the operating system."
        copy="Move recurring decisions and knowledge into visible seats, numbers, decision rights, and meeting rhythm."
      />
      <div className="mx-auto mt-[2.2cqw] grid w-[82cqw] grid-cols-[1fr_9cqw_1fr] items-center gap-[1.5cqw]">
        <div className="grid grid-cols-2 gap-[0.7cqw]">
          {dependencies.map((item) => (
            <DiagramCard key={item} title={item} />
          ))}
        </div>
        <div className="grid aspect-square place-items-center rounded-full border-[0.25cqw] border-[#d97757] bg-[#1f1e1b] text-center text-[#faf9f5]">
          <div>
            <p className="font-mono text-[0.7cqw] uppercase tracking-[0.2em] text-[#d97757]">
              Bottleneck
            </p>
            <p className="mt-[0.4cqw] font-display text-[1.7cqw]">Owner</p>
          </div>
        </div>
        <div className="space-y-[0.8cqw]">
          <DiagramCard number="01" title="Seat" copy="Who owns the outcome?" accent />
          <DiagramCard number="02" title="Number" copy="What makes performance visible?" />
          <DiagramCard number="03" title="Rhythm" copy="Where is it reviewed and solved?" />
        </div>
      </div>
    </div>
  );
}

function ControlLevels() {
  const levels = [
    ["01", "AOS", "Company control", "Direction · accountability · scorecards · issues"],
    ["02", "IOR in OverWatch", "Project control", "Forecast · risk · billing · schedule · margin"],
    [
      "03",
      "Daily Project WIP",
      "Field control",
      "Installed work · earned value · actual cost · trend",
    ],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="The Professional Contractor Control Loop"
        title="Teach top-down. Install bottom-up."
      />
      <div className="mx-auto mt-[2.2cqw] grid w-[84cqw] gap-[0.8cqw]">
        {levels.map(([number, title, label, copy], index) => (
          <div
            key={title}
            className={`grid grid-cols-[7cqw_20cqw_1fr] items-center rounded-[0.8cqw] border px-[1.5cqw] py-[1.05cqw] ${index === 2 ? "border-[#d97757] bg-[#f4e7df]" : "border-[#d8d4c8] bg-white/75"}`}
          >
            <span className="font-mono text-[0.75cqw] text-[#c36e4f]">[ {number} ]</span>
            <div>
              <p className="font-display text-[1.65cqw]">{title}</p>
              <p className="font-mono text-[0.65cqw] uppercase tracking-[0.16em] text-[#76736b]">
                {label}
              </p>
            </div>
            <p className="text-[0.88cqw] text-[#76736b]">{copy}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EconomicsEngine() {
  const constraints = ["PM bandwidth", "Admin billing", "Bonding", "Cash capacity"];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Economics engine"
        title="The revenue goal is only real if capacity can carry it."
      />
      <div className="mx-auto mt-[2.4cqw] grid w-[84cqw] grid-cols-[18cqw_5cqw_1fr_5cqw_18cqw] items-center">
        <DiagramCard
          label="Target"
          title="Revenue goal"
          copy="What the company wants to produce."
        />
        <Arrow />
        <div className="grid grid-cols-2 gap-[0.7cqw]">
          {constraints.map((item, index) => (
            <DiagramCard
              key={item}
              number={String(index + 1).padStart(2, "0")}
              title={item}
              accent={item === "Cash capacity"}
            />
          ))}
        </div>
        <Arrow />
        <DiagramCard
          label="Truth"
          title="Annual billing capacity"
          copy="The lowest constraint sets the current ceiling."
          accent
        />
      </div>
    </div>
  );
}

function FormulaRow({
  sign,
  title,
  copy,
  accent = false,
}: {
  sign: string;
  title: string;
  copy: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[5cqw_30cqw_1fr] items-center border-b px-[1.2cqw] py-[0.75cqw] last:border-b-0 ${accent ? "border-[#d97757] bg-[#f4e7df]" : "border-[#d8d4c8]"}`}
    >
      <span className={`font-mono text-[1.4cqw] ${accent ? "text-[#c36e4f]" : "text-[#1f1e1b]"}`}>
        {sign}
      </span>
      <span className="font-display text-[1.45cqw]">{title}</span>
      <span className="text-[0.76cqw] leading-[1.35] text-[#76736b]">{copy}</span>
    </div>
  );
}

function IorFormula() {
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Project financial truth"
        title="IOR Formula"
        copy="The best current expectation of where the project is indicating it will land."
      />
      <div className="mx-auto mt-[1.6cqw] w-[75cqw] overflow-hidden rounded-[0.8cqw] border border-[#d8d4c8] bg-white/75">
        <FormulaRow
          sign=""
          title="Forecasted Final Contract"
          copy="Current expected total contract value."
        />
        <FormulaRow
          sign="−"
          title="Forecasted Final Cost"
          copy="Current expected cost to complete."
        />
        <FormulaRow
          sign="−"
          title="Exposure Holds"
          copy="Known, specific risks likely to cost money."
        />
        <FormulaRow
          sign="−"
          title="Contingency Holds"
          copy="General uncertainty held as management reserve."
        />
        <FormulaRow
          sign="="
          title="Indicated Gross Profit"
          copy="The project's true profit outlook today."
          accent
        />
      </div>
    </div>
  );
}

function FieldControl() {
  const steps = [
    ["01", "Daily log", "What happened, who performed it, and what affected the work."],
    ["02", "Installed quantity", "Completed production tied to the correct SOV activity."],
    [
      "03",
      "Earned vs. spent",
      "Daily earned value compared with labor, material, equipment, and sub cost.",
    ],
    ["04", "Trend", "Production rate, schedule position, billing position, and forecast movement."],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Field control"
        title="Daily Project WIP"
        copy="Reconcile the work while the outcome can still change—not after the billing cycle closes."
      />
      <div className="mx-auto mt-[2.2cqw] grid w-[84cqw] grid-cols-2 gap-[0.9cqw]">
        {steps.map(([number, title, copy], index) => (
          <DiagramCard key={title} number={number} title={title} copy={copy} accent={index === 2} />
        ))}
      </div>
      <div className="mx-auto mt-[1.2cqw] rounded-full bg-[#1f1e1b] px-[3cqw] py-[0.75cqw] font-mono text-[0.72cqw] uppercase tracking-[0.18em] text-[#faf9f5]">
        Daily truth → Weekly IOR → Company action
      </div>
    </div>
  );
}

function RiskAction() {
  const steps = [
    ["01", "See", "Name the event and affected outcome."],
    ["02", "Price", "Probability × impact = useful exposure."],
    ["03", "Choose", "Eliminate · recover · offset · accept."],
    ["04", "Own", "Assign an owner, action, and review date."],
    ["05", "Update", "Move the hold and indicated profit."],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading eyebrow="Risk is the job" title="Turn risk into owned action." />
      <div className="mt-[2.7cqw] flex items-stretch gap-[0.65cqw]">
        {steps.map(([number, title, copy], index) => (
          <div key={title} className="contents">
            <DiagramCard number={number} title={title} copy={copy} accent={index === 2} />
            {index < steps.length - 1 ? (
              <div className="flex items-center">
                <Arrow />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyRhythm() {
  const steps = [
    "Daily logs",
    "Daily Project WIP",
    "PM risk review",
    "IOR update",
    "AOS issue solving",
    "Owned field action",
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Control rhythm"
        title="Field truth must travel all the way to company action."
        copy="Then the decision must travel back to the project and the field."
      />
      <div className="mx-auto mt-[2.6cqw] flex w-[90cqw] items-stretch gap-[0.55cqw]">
        {steps.map((title, index) => (
          <div key={title} className="contents">
            <DiagramCard
              number={String(index + 1).padStart(2, "0")}
              title={title}
              accent={index === 1 || index === 4}
            />
            {index < steps.length - 1 ? (
              <div className="flex items-center">
                <Arrow />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-[1.4cqw] text-center font-mono text-[0.75cqw] uppercase tracking-[0.2em] text-[#76736b]">
        Month-end confirms the trend. It should not reveal it.
      </p>
    </div>
  );
}

function DeliverySystems() {
  const systems = [
    ["Change orders", "Issue → price → approve → bill → collect"],
    ["Delay / EOT", "Notice → responsibility → entitlement → time"],
    ["Selections", "Decision → approval → procurement → field"],
    ["Burn rate", "Time → cost → exposure → recovery"],
  ];
  return (
    <div className="flex h-full flex-col justify-center">
      <VisualHeading
        eyebrow="Delivery control"
        title="Standardize the workflows that protect margin."
      />
      <div className="mx-auto mt-[2.5cqw] grid w-[82cqw] grid-cols-2 gap-[1cqw]">
        {systems.map(([title, copy], index) => (
          <DiagramCard
            key={title}
            number={String(index + 1).padStart(2, "0")}
            title={title}
            copy={copy}
            accent={index === 0}
          />
        ))}
      </div>
    </div>
  );
}

export function VisualLabel({ children }: { children: ReactNode }) {
  return <span className="font-mono uppercase tracking-[0.18em] text-[#76736b]">{children}</span>;
}
