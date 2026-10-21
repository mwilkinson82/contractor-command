// Every accounting, log and record tool, registered as one group (phases 1 to 7).
import { paymentTermsSave, retainageRuleSave } from "./accounting-tools";

export const ACCOUNTING_TOOLS = [retainageRuleSave, paymentTermsSave];
