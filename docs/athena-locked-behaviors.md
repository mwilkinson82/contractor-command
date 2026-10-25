# Athena locked behaviors

These behaviors are checked by `src/lib/mcp/athena-locked-behaviors.test.ts`.

## Grok Bot does not show render orders

Grok Bot prints tool text to the member. These lines are host orders, so they must not appear in that text:

- `REQUIRED VIEW` (including `REQUIRED VIEW: render this HTML card as-is… (spec V6QPP3)`)
- `Card shown. Do not add text.`
- `REQUIRED: Any email card`

Where they are built:

- `REQUIRED VIEW: render this HTML card as-is…` is `htmlBlock()` in `src/lib/mcp/cards/markdown.ts`. `stampCanary()` in `src/lib/mcp/security.ts` appends ` (spec V6QPP3)` to a `REQUIRED VIEW` line.
- `Card shown. Do not add text.` is `CARD_SHOWN` in `src/lib/mcp/cards/silence.ts`, appended by `applyCardClosing()`.
- `REQUIRED: Any email card… To:` is `sovRequiredTop()` in `src/lib/mcp/visible.ts`.

On a Grok Bot `tools/call` for the contract (`contract_terms`), the SOV (`report`), the morning brief (`morning_brief`), the morning meeting (`pm_morning`, and the same meeting card on `pm_meeting`, `pm_evening`, `athena_morning_hitlist`, `athena_hello`), and drawing markup (`drawing_markup`), those lines are removed from `content` text and appended to `structuredContent.assistant_guidance`. That field is the non-displayed channel the model can still read. The HTML document in the text is not edited. Fenced member text that quotes an order is left as written.

`NATIVE_CARD_TOOLS` is unchanged. Morning meeting and drawing markup are not added to it.

## ChatGPT and Claude cards stay byte-identical

ChatGPT does not show these lines to the member. Its `tools/call` result is not rewritten: the same object goes out, including the HTML card and the orders in the text. Claude's native-card reply is still the existing facts-only pass (`cards/claude-reply.ts`). `structuredContent.html` is not modified for either host.

## ChatGPT drawing attachment hosts are an exact list

`allowedDrawingDownloadUrl` in `src/lib/mcp/drawing-set.ts` accepts an attachment download only over HTTPS, with no userinfo and no non-default port. Hosts are the existing file hosts (`oaiusercontent.com` and `openai.com`, including `files.oaiusercontent.com`) plus these exact storage accounts:

- `oaisdmntprbrazilsouth.blob.core.windows.net`
- `oaisdmntpreastus2.blob.core.windows.net`

There is no prefix and no `*.blob.core.windows.net` pattern. Azure storage account names are first-come, so these are refused before any fetch:

- `oaiexample.blob.core.windows.net`
- `oaisdmntpreastus3.blob.core.windows.net`
- `evil-oaisdmntpre.blob.core.windows.net`
- `oaisdmntpre.blob.core.windows.net.evil.com`
- any other `*.blob.core.windows.net` account
- `http://` links to an otherwise exact host

Fetch uses `redirect: "manual"` and refuses every 3xx. The 50 MB cap, PDF validation, hash dedupe, and immutable originals stay as they are. `drawing_markup` does not download an attachment. A rejected import returns before a markup is saved.

## Lookahead lines keep the activity id

Split activities that share a name (A1110a and A1110b, A1120a and A1120b) are printed with the id and the name, for example `A1110a – Underground conduit rough-in`. The phone lookahead text and the lookahead card activity cell both use that form. A name that is only the id stays the id.

## A living-report data date cannot be after today

`living_report_save` reads the data date in America/Manaus. When `data_date` is omitted, the save uses today there, as `YYYY-MM-DD`. A data date later than that today is refused before the change-note date check. The refusal is plain words and ends with `Nothing was saved.`

## Company-profile project software answers setup

`next_question` checks the company profile before it asks which project software the job uses. A saved profile value (the `project_software` tool-stack entry, or a scheduling, project, or pm entry) is recorded on the job and the question is not asked. An empty profile, an unknown value, or an unrelated tool such as accounting still asks the question.

## A saved IOR includes its sections

`living_report_get` for an IOR still prints the board links, the version line, and the change log. It also prints the saved IOR sections as readable text: the title, job health, and each section such as risk allocations and top three actions. Internal ids stay out of that text.

## Lookahead window rows keep the activity id

The lookahead card section "Schedule activities in this window" and its text fallback "Schedule in this window" label each activity with its id, name, and dates, for example `A1110a – Underground conduit & grounding, Nov 2 to Nov 11`. Split pairs that share a name stay on separate rows. The row label is the only card change. Card styling is unchanged.

## Grok Bot's IOR reply includes the sections

ChatGPT and Claude keep the existing IOR card HTML and tool text. Grok Bot does not draw that card. Its `living_report_get` text for an IOR is the plain reply: board links, the IOR sections, the version line, and the change log. The section text is in that plain reply. `structuredContent.html` is not rewritten.

## The company profile read says its heading once

The onboarding read, titled `What I have so far`, prints that heading once in the text. The profile is printed once. The ChatGPT and Claude card HTML is the same card as before, including its state line. The duplicate bold heading and the second plain-text copy of the profile are not added under the card.

## A submittal void keeps the row

`submittal_void` is the void action for ChatGPT, Claude, and Grok Bot. Any status can be marked Void. The row is not deleted. Nothing is written until the member says yes and the call passes `confirmed` true with the matching `confirm_key`. The project record keeps who (`auth.uid`), when (the event time), and the reason. The open log drops the row. History, the log text, and the record-page status (through `submittalDisplayStatus`, not a page-template edit) say Void. An unsent package still reads as a draft for every other status.
