export type StateOfControlReportData = {
  generatedAt: string;
  total: number;
  maturityTitle: string;
  maturityCopy: string;
  primaryCategory: string;
  primaryConstraint: string;
  primaryImpact: string;
  capacityGap: string;
  annualCapacity: string;
  revenueGoal: string;
  limitingCapacity: string;
  categories: Array<{
    title: string;
    score: number;
    impact: string;
  }>;
  roadmap: Array<{
    period: string;
    title: string;
    impact: string;
    playbook: string;
    worksheet: string;
  }>;
  symptoms: string[];
  financialImpact: string;
  actions: string[];
  routing: Array<{ label: string; value: string }>;
};

export function StateOfControlPrintReport({ data }: { data: StateOfControlReportData }) {
  return (
    <>
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0; }
          body { background: #f7f3eb !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .soc-screen { display: none !important; }
          body * { visibility: hidden !important; }
          #state-of-control-report, #state-of-control-report * { visibility: visible !important; }
          #state-of-control-report {
            display: block !important;
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
          }
          .soc-print-page {
            box-sizing: border-box;
            width: 8.5in;
            min-height: 11in;
            padding: 0.58in 0.64in 0.5in;
            background: #f7f3eb;
            color: #211f1b;
            page-break-after: always;
            break-after: page;
            position: relative;
          }
          .soc-print-page:last-child { page-break-after: auto; break-after: auto; }
          .soc-no-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <div id="state-of-control-report" className="hidden font-sans">
        <ReportPage number="01" generatedAt={data.generatedAt}>
          <ReportHeader
            eyebrow="Professional contractor control"
            title="State of Control"
            copy="A current operating diagnosis across company, project, and field control."
          />

          <div className="mt-8 grid grid-cols-[1.05fr_0.95fr] gap-4">
            <div className="rounded-[18px] bg-[#211f1b] p-6 text-[#f7f3eb]">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#f06b3d]">
                Control score
              </p>
              <div className="mt-4 flex items-end gap-2">
                <span className="font-display text-[72px] leading-none">{data.total}</span>
                <span className="pb-2 font-mono text-[11px] text-[#f7f3eb]/55">/100</span>
              </div>
              <h2 className="mt-3 font-display text-[27px] leading-none">{data.maturityTitle}</h2>
              <p className="mt-3 text-[11px] leading-[1.55] text-[#f7f3eb]/70">
                {data.maturityCopy}
              </p>
            </div>
            <div className="rounded-[18px] border border-[#d8d1c5] bg-[#fffdf8] p-6">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#817b72]">
                Primary constraint
              </p>
              <h2 className="mt-3 font-display text-[28px] leading-[1.05]">
                {data.primaryConstraint}
              </h2>
              <p className="mt-3 text-[11px] leading-[1.55] text-[#625d55]">{data.primaryImpact}</p>
              <div className="mt-5 border-t border-[#ded7cc] pt-4">
                <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#817b72]">
                  Limiting capacity
                </p>
                <p className="mt-1 text-[13px] font-semibold">{data.limitingCapacity}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <PrintMetric label="Revenue goal" value={data.revenueGoal} />
            <PrintMetric label="Annual capacity" value={data.annualCapacity} />
            <PrintMetric label="Capacity gap" value={data.capacityGap} signal />
          </div>

          <section className="mt-7">
            <SectionLabel>Control domains</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {data.categories.map((category, index) => (
                <div
                  key={category.title}
                  className="soc-no-break rounded-xl border border-[#ded7cc] bg-[#fffdf8] p-3.5"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[8px] text-[#f06b3d]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="font-display text-[17px]">{category.title}</h3>
                    </div>
                    <span className="font-mono text-[10px] text-[#f06b3d]">
                      {category.score}/20
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#ebe5dc]">
                    <div
                      className="h-full bg-[#211f1b]"
                      style={{ width: `${category.score * 5}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[9px] leading-[1.45] text-[#6e685f]">{category.impact}</p>
                </div>
              ))}
            </div>
          </section>
        </ReportPage>

        <ReportPage number="02" generatedAt={data.generatedAt}>
          <ReportHeader
            eyebrow="Implementation route"
            title="The Next 90 Days"
            copy={`Resolve ${data.primaryCategory} first, then install the next two controls in order of operating risk.`}
          />

          <div className="mt-8 space-y-4">
            {data.roadmap.map((item, index) => (
              <article
                key={item.period}
                className="soc-no-break grid grid-cols-[90px_1fr] overflow-hidden rounded-[18px] border border-[#d8d1c5] bg-[#fffdf8]"
              >
                <div
                  className={
                    index === 0
                      ? "bg-[#f06b3d] p-5 text-[#211f1b]"
                      : "bg-[#211f1b] p-5 text-[#f7f3eb]"
                  }
                >
                  <p className="font-mono text-[8px] uppercase tracking-[0.2em] opacity-65">
                    {item.period}
                  </p>
                  <p className="mt-3 font-display text-[34px] leading-none">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                </div>
                <div className="p-5">
                  <h2 className="font-display text-[25px] leading-none">{item.title}</h2>
                  <p className="mt-2 text-[10.5px] leading-[1.5] text-[#625d55]">{item.impact}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#ded7cc] pt-3 text-[9px]">
                    <div>
                      <p className="font-mono text-[7px] uppercase tracking-[0.18em] text-[#817b72]">
                        Playbook
                      </p>
                      <p className="mt-1 font-medium">{item.playbook}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[7px] uppercase tracking-[0.18em] text-[#817b72]">
                        Worksheet
                      </p>
                      <p className="mt-1 font-medium">{item.worksheet}</p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4">
            <section className="soc-no-break rounded-[18px] border border-[#d8d1c5] bg-[#fffdf8] p-5">
              <SectionLabel>Constraint symptoms</SectionLabel>
              <ul className="mt-4 space-y-3">
                {data.symptoms.map((symptom) => (
                  <li key={symptom} className="flex gap-3 text-[10px] leading-[1.5]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#f06b3d]" />
                    <span>{symptom}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="soc-no-break rounded-[18px] bg-[#211f1b] p-5 text-[#f7f3eb]">
              <SectionLabel light>Financial consequence</SectionLabel>
              <p className="mt-4 font-display text-[20px] leading-[1.25]">{data.financialImpact}</p>
            </section>
          </div>
        </ReportPage>

        <ReportPage number="03" generatedAt={data.generatedAt}>
          <ReportHeader
            eyebrow="Constraint resolution plan"
            title={data.primaryConstraint}
            copy="Turn the diagnosis into owned action, review it on rhythm, and remeasure the state of control."
          />

          <section className="mt-8 rounded-[18px] border border-[#d8d1c5] bg-[#fffdf8] p-6">
            <SectionLabel>Next 30 days</SectionLabel>
            <ol className="mt-5 grid grid-cols-2 gap-3">
              {data.actions.map((action, index) => (
                <li
                  key={action}
                  className="soc-no-break flex gap-3 rounded-xl bg-[#f1ece3] p-4 text-[10px] leading-[1.5]"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f06b3d]/15 font-mono text-[8px] text-[#d8552c]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-5 rounded-[18px] border border-[#d8d1c5] bg-[#fffdf8] p-6">
            <SectionLabel>System routing</SectionLabel>
            <dl className="mt-4 divide-y divide-[#ded7cc]">
              {data.routing.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[105px_1fr] gap-4 py-3 text-[10px] first:pt-0 last:pb-0"
                >
                  <dt className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#817b72]">
                    {row.label}
                  </dt>
                  <dd className="font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-5 rounded-[18px] bg-[#211f1b] p-6 text-[#f7f3eb]">
            <p className="font-mono text-[8px] uppercase tracking-[0.22em] text-[#f06b3d]">
              Use the data
            </p>
            <h2 className="mt-3 font-display text-[27px] leading-none">
              Create a management rhythm.
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-x-7 gap-y-4 text-[10px] leading-[1.45] text-[#f7f3eb]/75">
              <p>
                <strong className="text-[#f7f3eb]">Save the baseline.</strong> Keep this report in
                the Vault as the agreed starting point.
              </p>
              <p>
                <strong className="text-[#f7f3eb]">Assign ownership.</strong> Name one person
                accountable for the first 30-day action.
              </p>
              <p>
                <strong className="text-[#f7f3eb]">Review weekly.</strong> Move the active
                constraint into AOS and the project or field facts into OverWatch.
              </p>
              <p>
                <strong className="text-[#f7f3eb]">Remeasure in 90 days.</strong> Compare the new
                result to this baseline and reset the route.
              </p>
            </div>
          </section>
        </ReportPage>
      </div>
    </>
  );
}

function ReportPage({
  number,
  generatedAt,
  children,
}: {
  number: string;
  generatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <section className="soc-print-page">
      {children}
      <footer className="absolute bottom-[0.28in] left-[0.64in] right-[0.64in] flex items-center justify-between border-t border-[#d8d1c5] pt-2 font-mono text-[7px] uppercase tracking-[0.16em] text-[#817b72]">
        <span>ALP Contractor Circle · State of Control</span>
        <span>
          {generatedAt} · {number}
        </span>
      </footer>
    </section>
  );
}

function ReportHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <header className="border-b border-[#d8d1c5] pb-6">
      <div className="flex items-start justify-between gap-8">
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.24em] text-[#f06b3d]">
            {eyebrow}
          </p>
          <h1 className="mt-3 font-display text-[39px] leading-none">{title}</h1>
          <p className="mt-3 max-w-[470px] text-[11px] leading-[1.5] text-[#625d55]">{copy}</p>
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#211f1b] font-display text-[16px] text-[#f7f3eb]">
          ALP
        </div>
      </div>
    </header>
  );
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p
      className={`font-mono text-[8px] uppercase tracking-[0.22em] ${light ? "text-[#f7f3eb]/55" : "text-[#817b72]"}`}
    >
      {children}
    </p>
  );
}

function PrintMetric({
  label,
  value,
  signal = false,
}: {
  label: string;
  value: string;
  signal?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#ded7cc] bg-[#fffdf8] p-4">
      <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#817b72]">{label}</p>
      <p
        className={`mt-2 text-[15px] font-semibold ${signal ? "text-[#e45f35]" : "text-[#211f1b]"}`}
      >
        {value}
      </p>
    </div>
  );
}
