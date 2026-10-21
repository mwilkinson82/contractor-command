// Phase 7 tool: form_map_save. Company-level; owner or all-access only.
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, text } from "../guard";
import { audit, resolveCompany } from "../jobs";
import { rpc } from "../accounting/db";
import { requireApproved } from "../accounting/foundations";
import { FORM_MAP_RULE, VALUE_KEYS, mapProblems } from "../accounting/form-map";

export const formMapSave = defineTool({
  name: "form_map_save",
  title: "Save a licensed form field map (after approval)",
  description: `Saves the field map for the company's own licensed G702 or G703: form field id to Athena value key. ${FORM_MAP_RULE} Call only after the user says yes. Owner or all-access only.`,
  inputSchema: {
    company_id: z.string().trim().min(1).max(200).optional(), approved: z.literal(true),
    form: z.enum(["G702", "G703"]), edition: z.string().trim().max(4),
    fields: z.array(z.object({ field_id: z.string().max(64), value: z.enum(VALUE_KEYS) })).min(1).max(200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("form_map_save", ctx, {}, async (sb) => {
      requireApproved(args);
      const company = await resolveCompany(sb, args.company_id);
      const p = mapProblems({ form: args.form, edition: args.edition, fields: args.fields });
      if (p.length) throw new ToolError(`${p.join(" ")} Nothing was saved.`);
      await rpc(sb, "mcp_form_map_save", { _company: company, _form: args.form, _edition: args.edition, _fields: args.fields });
      await audit(sb, null, "form_map_save", "save_form_map", null, company);
      return text(`${args.form} (${args.edition}) field map saved: ${args.fields.length} fields. Only the map is stored.`);
    }),
});
