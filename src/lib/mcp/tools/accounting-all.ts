// Every accounting, log and record tool, registered as one group (phases 1 to 7).
import { paymentTermsSave, retainageRuleSave } from "./accounting-tools";
import { PAYAPP_TOOLS } from "./payapp-tools";
import { AR_TOOLS } from "./ar-tools";
import { LOG_TOOLS } from "./log-tools";
import { TRANSMITTAL_TOOLS } from "./transmittal-tools";
import { LEDGER_TOOLS } from "./ledger-tools";
import { RECORD_TOOLS } from "./record-tools";

export const ACCOUNTING_TOOLS = [retainageRuleSave, paymentTermsSave, ...PAYAPP_TOOLS, ...AR_TOOLS, ...LOG_TOOLS, ...TRANSMITTAL_TOOLS, ...LEDGER_TOOLS, ...RECORD_TOOLS];
