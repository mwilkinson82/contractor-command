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
      "Athena couldn't check this company's estimating plan. Your drawings are saved; please try again.",
    );
  if (["athena_office", "circle", "hardcore"].includes(data.toLowerCase())) return null;
  return {
    state: "result",
    show_state: false,
    title: "Estimating with Athena Office",
    job: job.job_number,
    sections: [
      {
        heading: "Your next step",
        kind: "list",
        rows: [
          {
            cells: [
              "Drawing takeoff and estimating are included in Athena Office ($397/month), Contractor Circle and Hardcore.",
              "Your PM plan ($197/month) keeps its project management tools. Ask your company owner to upgrade to Office when you're ready to estimate. Your saved work stays intact.",
            ],
          },
        ],
      },
    ],
    next_move: "Continue with project management, or ask your company owner about Office.",
  };
}
