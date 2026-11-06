/**
 * Athena is the member's job system of record. Hosts (Claude especially) often only reach for
 * Athena when the member says "Hey Athena", so job work done in plain chat never reaches the
 * job board. This rule sits in the first few routing rules so a truncated instructions block keeps it.
 */
export const JOB_RECORD_RULE =
  " Athena is the member's job system of record. Whenever the member works on a construction job in this chat, use Athena's tools without waiting for them to say Athena or Hey Athena: building or updating a schedule, a daily report, an RFI, RFC, change order, submittal, contract, SOV, budget, pay app or open item, or any question about a saved job. Read the saved job first, then save the result to it with the matching tool (schedule: living_report_save with report_type cpm; daily report: daily_report_save; RFI: rfi_record; RFC: rfc_record; change order: change_order_record; submittal: submittal_log; contract: job_contracts; pay app: payment_application_record; job setup, SOV or budget: intake). Work kept only in chat, an artifact or a file never reaches the member's job board, so never leave a job record there without saving it to Athena; if no job is named, call jobs_list and ask which saved job. Saves that need the member's yes still ask first. After a save, say it is saved and give the board link when the tool returns one. ";
