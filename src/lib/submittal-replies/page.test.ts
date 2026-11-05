import { describe, expect, it, vi } from "vitest";
import { handleSubmittalReturn, returnCsrf, returnFileName, sniffReturnFile } from "./page";
import {
  replyAddress,
  replyCodeFor,
  replyCodeFromAddress,
  replyCodeFromAddresses,
  replyCodeHash,
  withReplyCapture,
} from "./reply-link";

const code = "0123456789abcdef0123456789abcdef";
const url = `https://app.meetathena.io/r/submittal-return/${code}`;
const cookie = "C".repeat(43);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const open = {
  status: "ok",
  company: "Northline Electric",
  logo_url: null,
  company_id: "00000000-0000-4000-8000-0000000000c1",
  job_id: "00000000-0000-4000-8000-0000000000j1".replace("j", "a"),
  job_number: "2810",
  job_name: "Willow Creek",
  number: "26 51 00-01",
  revision: 0,
  title: "Lighting fixtures",
  spec_section: "26 51 00",
  transmittal_number: 4,
  returned: null as null | Record<string, unknown>,
};
const recorded = {
  status: "ok",
  response_id: "00000000-0000-4000-8000-0000000000r1".replace("r", "b"),
  job_id: open.job_id,
  company_id: open.company_id,
  submittal_id: "s",
  package_id: "p",
  source: "page",
  action: "approved_as_noted",
  action_label: "Approved as noted",
  review_status: "recorded",
  reviewer_name: "Jordan Lee",
  reviewer_email: null,
  sender_known: null,
  file_count: 1,
  number: open.number,
  revision: 0,
  title: open.title,
  job_number: "2810",
  job_name: "Willow Creek",
  company: "Northline Electric",
};

function deps(over: Partial<Record<string, unknown>> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const uploads: { path: string; size: number; type: string }[] = [];
  const sent: { to: string; subject: string; html: string }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn in over) return over[fn];
    if (fn === "mcp_submittal_reply_page_open") return open;
    if (fn === "mcp_submittal_reply_page_try") return { status: "ok" };
    if (fn === "mcp_submittal_reply_page_submit") return recorded;
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
        recipients: [
          { email: "pm@northline.example", role: "job_pm" },
          { email: "super@northline.example", role: "super" },
        ],
      };
    return null;
  });
  return {
    calls,
    uploads,
    sent,
    d: {
      rpc,
      upload: async (path: string, bytes: Uint8Array, type: string) => {
        uploads.push({ path, size: bytes.length, type });
      },
      send: async (m: { to: string; subject: string; html: string }) => {
        sent.push(m);
        return "sent" as const;
      },
      newId: () => recorded.response_id,
    },
  };
}

async function post(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v as string);
  return new Request(url, {
    method: "POST",
    body: fd,
    headers: { origin: "https://app.meetathena.io", cookie: `athena_sr=${cookie}`, ...headers },
  });
}

describe("reply codes", () => {
  it("derives one lower-case code per package link and reads it back from the capture address", async () => {
    const link = `https://app.meetathena.io/r/submittal-file/${"a".repeat(43)}`;
    const a = await replyCodeFor(link);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await replyCodeFor(link)).toBe(a);
    expect(
      await replyCodeFor(`https://app.meetathena.io/r/submittal-file/${"b".repeat(43)}`),
    ).not.toBe(a);
    expect(await replyCodeFor("not a link")).toBeNull();
    expect(replyCodeFromAddress(`Athena <SUBMITTALS+${a!.toUpperCase()}@MeetAthena.io>`)).toBe(a);
    expect(replyCodeFromAddress(`submittals+${a}@alpcontractorcircle.com`)).toBe(a);
    expect(replyCodeFromAddress(`submittals+${a}@evil.example`)).toBeNull();
    expect(replyCodeFromAddress("support@meetathena.io")).toBeNull();
    expect(replyCodeFromAddresses(["x@y.com", replyAddress(a!)])).toBe(a);
    expect(await replyCodeHash(a!)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("adds the capture address and return page to a draft once", () => {
    const d = {
      to: "jordan@arch.example",
      cc: ["sam@sub.example"],
      subject: "S",
      body: "Please review.",
    };
    const once = withReplyCapture(d, code);
    expect(once.cc).toEqual(["sam@sub.example", `submittals+${code}@meetathena.io`]);
    expect(once.body).toContain(url);
    expect(withReplyCapture(once, code)).toEqual(once);
  });

  it("takes PDF, PNG and JPEG by their bytes and names them safely", () => {
    expect(sniffReturnFile(pdf)?.mime).toBe("application/pdf");
    expect(sniffReturnFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe("jpg");
    expect(sniffReturnFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(returnFileName("../../etc/Stamped copy (rev 1).PDF", "pdf")).toBe(
      "Stamped-copy-rev-1.pdf",
    );
    expect(returnFileName("evil.exe", "png")).toBe("evil.png");
    expect(returnFileName("", "pdf")).toBe("stamped-copy.pdf");
  });
});

describe("reviewer return page", () => {
  it("shows the contractor's brand, number and title with a CSRF value and a cookie", async () => {
    const { d, calls } = deps();
    const res = await handleSubmittalReturn(new Request(url), code, d);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Northline Electric");
    expect(html).toContain("Return submittal 26 51 00-01");
    expect(html).toContain("Lighting fixtures");
    for (const label of [
      "Approved",
      "Approved as noted",
      "Revise and resubmit",
      "Rejected",
      "For record only",
    ])
      expect(html).toContain(label);
    expect(html).toContain("Powered by Athena");
    expect(html).not.toMatch(/cost|markup|submittal-file/i);
    expect(res.headers.get("set-cookie")).toMatch(
      /^athena_sr=[A-Za-z0-9_-]{43}; Path=\/r\/submittal-return\//,
    );
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(calls[0]!.args._token_hash).toBe(await replyCodeHash(code));
  });

  it("refuses bad codes and gone links without a form", async () => {
    const { d } = deps({
      mcp_submittal_reply_page_open: { status: "expired", company: "Northline Electric" },
    });
    expect((await handleSubmittalReturn(new Request(url), "nope", d)).status).toBe(404);
    const gone = await handleSubmittalReturn(new Request(url), code, d);
    expect(gone.status).toBe(410);
    const html = await gone.text();
    expect(html).toContain("This review link has expired");
    expect(html).not.toContain("<form");
  });

  it("refuses a post from another site, without the cookie, or with a wrong CSRF value", async () => {
    const { d, calls } = deps();
    const csrf = await returnCsrf(cookie);
    const fields = { csrf, action: "approved", reviewer_name: "Jordan Lee" };
    expect(
      (await handleSubmittalReturn(await post(fields, { origin: "https://evil.example" }), code, d))
        .status,
    ).toBe(403);
    expect((await handleSubmittalReturn(await post(fields, { cookie: "" }), code, d)).status).toBe(
      403,
    );
    expect(
      (await handleSubmittalReturn(await post({ ...fields, csrf: "x" }), code, d)).status,
    ).toBe(403);
    expect(calls.some((c) => c.fn === "mcp_submittal_reply_page_submit")).toBe(false);
  });

  it("asks again for a missing action, a short name, or a file that is not a PDF or image", async () => {
    const { d, uploads } = deps();
    const csrf = await returnCsrf(cookie);
    const noAction = await handleSubmittalReturn(
      await post({ csrf, reviewer_name: "Jordan Lee" }),
      code,
      d,
    );
    expect(noAction.status).toBe(400);
    expect(await noAction.text()).toContain("Pick your action.");
    const short = await handleSubmittalReturn(
      await post({ csrf, action: "approved", reviewer_name: "J" }),
      code,
      d,
    );
    expect(await short.text()).toContain("Type your name");
    const zip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])], {
      type: "application/pdf",
    });
    const bad = await handleSubmittalReturn(
      await post({
        csrf,
        action: "approved",
        reviewer_name: "Jordan Lee",
        file: new File([zip], "stamp.pdf"),
      }),
      code,
      d,
    );
    expect(await bad.text()).toContain("Attach a PDF, PNG or JPEG.");
    expect(uploads).toHaveLength(0);
  });

  it("refuses a file over 25 MB", async () => {
    const { d, uploads } = deps();
    const csrf = await returnCsrf(cookie);
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set(pdf);
    const res = await handleSubmittalReturn(
      await post({
        csrf,
        action: "approved",
        reviewer_name: "Jordan Lee",
        file: new File([big], "big.pdf"),
      }),
      code,
      d,
    );
    expect(res.status).toBe(413);
    expect(uploads).toHaveLength(0);
  });

  it("stores the stamped copy, records the decision and emails the job's PM and super once", async () => {
    const { d, calls, uploads, sent } = deps();
    const csrf = await returnCsrf(cookie);
    const res = await handleSubmittalReturn(
      await post({
        csrf,
        action: "approved_as_noted",
        reviewer_name: "  Jordan   Lee ",
        reviewer_email: "jordan@arch.example",
        comments: "See note on sheet 2.",
        file: new File([pdf], "Stamped.pdf", { type: "application/pdf" }),
      }),
      code,
      d,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/r/submittal-return/${code}`);
    expect(uploads).toEqual([
      {
        path: `${open.company_id}/${open.job_id}/returns/${recorded.response_id}/Stamped.pdf`,
        size: pdf.length,
        type: "application/pdf",
      },
    ]);
    const submit = calls.find((c) => c.fn === "mcp_submittal_reply_page_submit")!;
    expect(submit.args).toMatchObject({
      _action: "approved_as_noted",
      _reviewer_name: "Jordan Lee",
      _reviewer_email: "jordan@arch.example",
      _comments: "See note on sheet 2.",
    });
    expect(calls.findIndex((c) => c.fn === "mcp_submittal_reply_page_try")).toBeLessThan(
      calls.findIndex((c) => c.fn === "mcp_submittal_reply_page_submit"),
    );
    const notice = calls.find((c) => c.fn === "mcp_job_notice_record")!;
    expect(notice.args).toMatchObject({
      _topic: "submittal_reply",
      _kind: "submittal_returned",
      _board_page: "submittals",
      _dedupe_key: `submittal-reply:${recorded.response_id}`,
      _title: "Jordan Lee returned submittal 26 51 00-01: Approved as noted",
    });
    expect(sent.map((m) => m.to)).toEqual(["pm@northline.example", "super@northline.example"]);
    expect(sent[0]!.html).toContain(`/r/job/${open.job_id}/submittal/26%2051%2000-01`);
  });

  it("shows the thank you page once returned, and stops after too many tries", async () => {
    const { d } = deps({
      mcp_submittal_reply_page_open: {
        ...open,
        returned: {
          action_label: "Rejected",
          reviewer_name: "Jordan Lee",
          created_at: "2026-11-05T15:00:00Z",
          file_count: 1,
        },
      },
    });
    const res = await handleSubmittalReturn(new Request(url), code, d);
    const html = await res.text();
    expect(html).toContain("Thank you, Jordan");
    expect(html).toContain("<b>Rejected</b> was recorded on November 5, 2026.");
    expect(html).not.toContain("<form");
    const slow = deps({ mcp_submittal_reply_page_try: { status: "slow_down" } });
    const tried = await handleSubmittalReturn(
      await post({
        csrf: await returnCsrf(cookie),
        action: "approved",
        reviewer_name: "Jordan Lee",
      }),
      code,
      slow.d,
    );
    expect(tried.status).toBe(429);
    expect(slow.calls.some((c) => c.fn === "mcp_submittal_reply_page_submit")).toBe(false);
  });
});
