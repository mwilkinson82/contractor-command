import { describe, expect, it, vi } from "vitest";
import { handleResendInboundPost } from "@/lib/resend/inbound-http";
import { computeWebhookSignature } from "@/lib/resend/webhook-signature";
import { parseFrom, processSubmittalInbound, replyText } from "@/lib/resend/inbound-submittal";
import { replyCodeHash } from "@/lib/submittal-replies/reply-link";

const SECRET = `whsec_${btoa("test-secret-key-for-vitest-only!")}`;
const code = "0123456789abcdef0123456789abcdef";
const capture = `submittals+${code}@meetathena.io`;

async function signed(body: unknown) {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await computeWebhookSignature(SECRET, "msg_9", timestamp, payload);
  return new Request("https://app.meetathena.io/api/public/resend/inbound", {
    method: "POST",
    headers: {
      "svix-id": "msg_9",
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body: payload,
  });
}

function routes() {
  return {
    forward: vi.fn(async () => ({
      status: "forwarded" as const,
      resendId: "f",
      attachments: 0,
      droppedAttachments: 0,
    })),
    processSupport: vi.fn(async () => ({ status: "not_support" as const })),
    processSubmittal: vi.fn(async () => ({
      status: "submittal_reply" as const,
      responseId: "r1",
      created: true,
      files: 1,
      skippedFiles: 0,
      noticed: true,
    })),
  };
}
const env = { RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: "re_test" };

describe("inbound capture address routing", () => {
  it("sends mail for a capture address to the submittal and never forwards it", async () => {
    const r = routes();
    const res = await handleResendInboundPost(
      await signed({
        type: "email.received",
        data: {
          email_id: "em_9",
          to: ["Marshall <marshall@alp.example>"],
          cc: [`Athena <${capture.toUpperCase()}>`],
        },
      }),
      { env, ...(r as object) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "submittal_reply",
      responseId: "r1",
    });
    expect(r.processSubmittal).toHaveBeenCalledWith("em_9", { apiKey: "re_test", code });
    expect(r.forward).not.toHaveBeenCalled();
    expect(r.processSupport).not.toHaveBeenCalled();
  });

  it("still forwards other mail and asks Resend to retry a failed capture", async () => {
    const r = routes();
    await handleResendInboundPost(
      await signed({
        type: "email.received",
        data: { email_id: "em_1", to: ["hello@meetathena.io"] },
      }),
      {
        env,
        ...(r as object),
      },
    );
    expect(r.forward).toHaveBeenCalled();
    expect(r.processSubmittal).not.toHaveBeenCalled();
    const failing = routes();
    failing.processSubmittal.mockRejectedValueOnce(new Error("db down"));
    const res = await handleResendInboundPost(
      await signed({ type: "email.received", data: { email_id: "em_2", to: [capture] } }),
      { env, ...(failing as object) },
    );
    expect(res.status).toBe(500);
    expect(failing.forward).not.toHaveBeenCalled();
  });
});

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
function resend(email: Record<string, unknown>, attachments: Record<string, unknown>[] = []) {
  return vi.fn(async (input: string | URL | Request) => {
    const u = String(input);
    if (u.endsWith("/attachments"))
      return new Response(JSON.stringify({ data: attachments }), { status: 200 });
    if (u.includes("/emails/receiving/"))
      return new Response(JSON.stringify(email), { status: 200 });
    if (u === "https://files.resend.example/stamp.pdf") return new Response(pdf, { status: 200 });
    if (u === "https://files.resend.example/notes.docx")
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 });
    return new Response("nope", { status: 404 });
  });
}
const reply = {
  status: "ok",
  created: true,
  files: [],
  response_id: "00000000-0000-4000-8000-0000000000b1",
  job_id: "00000000-0000-4000-8000-0000000000a1",
  company_id: "00000000-0000-4000-8000-0000000000c1",
  submittal_id: "s",
  package_id: "p",
  source: "email",
  action: null,
  action_label: "Received, needs review",
  review_status: "needs_review",
  reviewer_name: "Jordan Lee",
  reviewer_email: "jordan@arch.example",
  sender_known: true,
  file_count: 0,
  number: "26 51 00-01",
  revision: 0,
  title: "Lighting fixtures",
  job_number: "2810",
  job_name: "Willow Creek",
  company: "Northline Electric",
};

function db(over: Record<string, unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn in over) return over[fn];
    if (fn === "mcp_submittal_reply_email") return reply;
    if (fn === "mcp_submittal_reply_files") return { status: "ok", files: args._files };
    if (fn === "mcp_job_notice_record")
      return {
        notice_id: "n1",
        created: true,
        topic: "submittal_reply",
        title: args._title,
        detail: args._detail,
        actor: args._actor,
        job_number: "2810",
        job_name: "Willow Creek",
        company: "Northline Electric",
        recipients: [{ email: "pm@northline.example", role: "job_pm" }],
      };
    return null;
  });
  return { calls, rpc };
}

describe("processSubmittalInbound", () => {
  it("keeps the reply as needs review with its PDF, skips other files and records one notice", async () => {
    const fetchFn = resend(
      {
        id: "em_9",
        from: "Jordan Lee <Jordan@Arch.example>",
        subject: "RE: Submittal 26 51 00-01 for review",
        text: "Revise and resubmit. Stamped copy attached.",
        message_id: "<abc@arch>",
        created_at: "2026-11-05T15:00:00Z",
        headers: { "In-Reply-To": "<gm@mail>" },
        attachments: [{ id: "a1" }, { id: "a2" }],
      },
      [
        {
          id: "a1",
          filename: "Stamped 26 51 00.pdf",
          size: 6,
          download_url: "https://files.resend.example/stamp.pdf",
        },
        {
          id: "a2",
          filename: "notes.docx",
          size: 4,
          download_url: "https://files.resend.example/notes.docx",
        },
      ],
    );
    const { calls, rpc } = db();
    const uploads: string[] = [];
    const sent: string[] = [];
    const out = await processSubmittalInbound("em_9", code, {
      apiKey: "re_test",
      fetch: fetchFn as never,
      rpc,
      upload: async (path) => {
        uploads.push(path);
      },
      send: async (m) => {
        sent.push(m.to);
        return "sent";
      },
    });
    expect(out).toMatchObject({
      status: "submittal_reply",
      files: 1,
      skippedFiles: 1,
      noticed: true,
    });
    const saved = calls.find((c) => c.fn === "mcp_submittal_reply_email")!.args;
    expect(saved).toMatchObject({
      _token_hash: await replyCodeHash(code),
      _inbound_email_id: "em_9",
      _from: "jordan@arch.example",
      _from_name: "Jordan Lee",
      _in_reply: true,
      _text: "Revise and resubmit. Stamped copy attached.",
    });
    expect(uploads).toEqual([
      `${reply.company_id}/${reply.job_id}/returns/${reply.response_id}/Stamped-26-51-00.pdf`,
    ]);
    const notice = calls.find((c) => c.fn === "mcp_job_notice_record")!.args;
    expect(notice).toMatchObject({
      _topic: "submittal_reply",
      _kind: "submittal_reply_received",
      _board_page: "submittals",
      _dedupe_key: `submittal-reply:${reply.response_id}`,
      _title: "Jordan Lee replied about submittal 26 51 00-01",
    });
    expect(String(notice._detail)).toContain("confirm it on the board or ask Athena");
    expect(sent).toEqual(["pm@northline.example"]);
  });

  it("records nothing for the team's own copy or an unknown code", async () => {
    const fetchFn = resend({
      id: "em_1",
      from: "owner@northline.example",
      subject: "x",
      text: "x",
    });
    for (const status of ["own_copy", "unknown"]) {
      const { calls, rpc } = db({ mcp_submittal_reply_email: { status } });
      const out = await processSubmittalInbound("em_1", code, {
        apiKey: "re_test",
        fetch: fetchFn as never,
        rpc,
        upload: async () => {},
        send: async () => "sent",
      });
      expect(out).toEqual({ status: "submittal_ignored", reason: status });
      expect(calls.map((c) => c.fn)).toEqual(["mcp_submittal_reply_email"]);
    }
  });

  it("does not fetch files again when a retried webhook already kept them", async () => {
    const fetchFn = resend({
      id: "em_9",
      from: "j@arch.example",
      subject: "Re: x",
      text: "ok",
      attachments: [{ id: "a1" }],
    });
    const { calls, rpc } = db({
      mcp_submittal_reply_email: { ...reply, created: false, files: [{ path: "x" }] },
    });
    const out = await processSubmittalInbound("em_9", code, {
      apiKey: "re_test",
      fetch: fetchFn as never,
      rpc,
      upload: async () => {},
      send: async () => "sent",
    });
    expect(out).toMatchObject({ created: false, files: 1 });
    expect(fetchFn.mock.calls.some(([u]) => String(u).endsWith("/attachments"))).toBe(false);
    expect(calls.some((c) => c.fn === "mcp_submittal_reply_files")).toBe(false);
  });

  it("reads the sender and the text of an HTML-only reply", () => {
    expect(parseFrom('"Lee, Jordan" <JL@Arch.example>')).toEqual({
      email: "jl@arch.example",
      name: "Lee, Jordan",
    });
    expect(parseFrom("jl@arch.example")).toEqual({ email: "jl@arch.example", name: null });
    expect(
      replyText({
        id: "x",
        from: "a",
        html: "<p>Approved &amp; stamped.</p><script>alert(1)</script><div>Thanks</div>",
      }),
    ).toBe("Approved & stamped.\nThanks");
  });
});
