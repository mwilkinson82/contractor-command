import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { postResendEmail } from "../src/lib/support/resend-send.ts";
import { renderSupportAutoreply } from "../src/lib/support/template.ts";
import {
  assertSupportFrom,
  SUPPORT_INBOXES,
  SUPPORT_PREVIEW_TO,
  type SupportInbox,
} from "../src/lib/support/ticket.ts";

const RECIPIENT = "marshall@marshallwilkinson.com";

const samples: Array<{ inbox: SupportInbox; ticketNumber: string }> = [
  { inbox: SUPPORT_INBOXES.athena, ticketNumber: "ATH-0001" },
  { inbox: SUPPORT_INBOXES.circle, ticketNumber: "CIR-0001" },
];

function renderedSamples() {
  if (SUPPORT_PREVIEW_TO !== RECIPIENT) {
    throw new Error("Preview recipient must stay marshall@marshallwilkinson.com");
  }
  return samples.map(({ inbox, ticketNumber }) => {
    const mail = renderSupportAutoreply({ inbox, ticketNumber });
    assertSupportFrom(inbox.from);
    return { inbox, ticketNumber, ...mail };
  });
}

function renderToDisk(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const sample of renderedSamples()) {
    const base = `support-autoreply-${sample.inbox.brand}`;
    writeFileSync(resolve(dir, `${base}.html`), sample.html);
    writeFileSync(resolve(dir, `${base}.txt`), sample.text);
  }
}

async function sendPreviews() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is required to send previews");
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 16);
  for (const sample of renderedSamples()) {
    const sent = await postResendEmail(
      apiKey,
      fetch,
      {
        from: sample.inbox.from,
        to: [RECIPIENT],
        subject: `Preview: ${sample.inbox.product} [${sample.ticketNumber}]`,
        html: sample.html,
        text: sample.text,
        headers: { "X-ALP-Support-Mail": "preview" },
      },
      `support-template-preview/${sample.inbox.brand}/${stamp}`,
    );
    console.log(
      `preview sent brand=${sample.inbox.brand} to=${RECIPIENT} id=${sent.id ?? "duplicate"}`,
    );
  }
}

const renderAt = process.argv.indexOf("--render");
if (renderAt !== -1) {
  const dir = process.argv[renderAt + 1];
  if (!dir || dir.startsWith("--")) {
    console.error(
      "Usage: node --experimental-strip-types scripts/support-autoreply-preview.ts --render <dir>",
    );
    process.exit(1);
  }
  renderToDisk(dir);
  console.log(`wrote support previews to ${dir}`);
} else {
  await sendPreviews();
}
