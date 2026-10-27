import { jobHomePath } from "@/lib/report-pages";

export type ProjectHomeJob = { id: string; job_number: string | null; name: string };

/** The account's saved-job list enters the same persistent home as onboarding. */
export function ProjectHomeLinks({ jobs }: { jobs: ProjectHomeJob[] }) {
  if (!jobs.length) return null;
  return (
    <section className="mt-8 rounded-2xl border border-[#D1D5DB] bg-white p-7">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
        Project homes
      </p>
      <ul className="mt-4 space-y-3">
        {jobs.map((job) => (
          <li key={job.id}>
            <a
              className="text-[15px] font-semibold text-[#1E3A5F] hover:text-[#2563EB]"
              href={jobHomePath(job.id)}
            >
              {job.job_number ? `${job.job_number} – ` : ""}
              {job.name}
            </a>
            <div className="text-[12px] text-[#6B7280]">Open project home</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
