// TEST helper: the Good/Better/Best release-proposal SQL, in apply order.
import { readFileSync, readdirSync } from "node:fs";

export const GBB_SQL_DIR = "release-proposals/good-better-best";
export const gbbSql = () =>
  readdirSync(GBB_SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${GBB_SQL_DIR}/${f}`, "utf8"));

/** The contract-stage migration that follows the release-proposal parts (customer view without product links). */
export const CHOICE_STAGE_MIGRATION =
  "supabase/migrations/20261104200000_athena_proposal_choice_stage.sql";
export const choiceStageSql = () => readFileSync(CHOICE_STAGE_MIGRATION, "utf8");

/** Time and added cost per upgrade: the board validator and customer view (the customer page part needs the portal). */
export const CHANGE_TERMS_MIGRATION =
  "supabase/migrations/20261105150000_athena_gbb_change_terms.sql";
export const changeTermsBoardSql = () => {
  const sql = readFileSync(CHANGE_TERMS_MIGRATION, "utf8");
  return sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.mcp_portal_decide"));
};
