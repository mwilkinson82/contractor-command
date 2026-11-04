// TEST helper: the Good/Better/Best release-proposal SQL, in apply order.
import { readFileSync, readdirSync } from "node:fs";

export const GBB_SQL_DIR = "release-proposals/good-better-best";
export const gbbSql = () =>
  readdirSync(GBB_SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${GBB_SQL_DIR}/${f}`, "utf8"));
