import { ToolError } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";
import { resolveJob } from "./jobs";
import type { CardModel } from "./cards/model";

export const estimatingTool = (name: string) =>
  name.startsWith("estimate_") ||
  ["sheet_calibrate", "takeoff_geometry", "drawing_set_import", "drawing_markup"].includes(name);

/** Use the existing entitlement decision for the resolved job's company, never the active-company guess. */
export async function estimatingUpgrade(
  sb: Sb,
  jobNumber: string,
  companyId?: string,
): Promise<CardModel | null> {
  const job = await resolveJob(sb, jobNumber, companyId);
  const { data, error } = await sb.rpc("mcp_company_tier", { _company: job.company_id });
  if (error || typeof data !== "string")
    throw new ToolError(
      "Athena couldn't check this company's estimating plan. No estimating operation was started. Please try again.",
    );
  if (["athena_office", "circle", "hardcore"].includes(data.toLowerCase())) return null;
  return {
    state: "result",
    show_state: false,
    title: "Estimating isn't on this company's plan",
    job: job.job_number,
    sections: [
      {
        heading: "Your next step",
        kind: "list",
        rows: [
          {
            cells: [
              "Drawing takeoff and estimating aren't included in this company's current plan. Project management tools keep working.",
              "Your saved work stays intact. Your company owner manages the plan on the Athena account page.",
            ],
          },
        ],
      },
    ],
    next_move: "Continue with project management, or ask your company owner about estimating.",
  };
}
