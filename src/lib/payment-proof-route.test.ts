import { describe, expect, it, vi } from "vitest";
import {
  handlePaymentProofUpload,
  readPaymentProof,
  type ProofDeps,
} from "./payment-proof-route.server";
import { sha256Hex } from "./mcp/file-share";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1),
  job = id(2),
  record = id(3),
  payment = id(4),
  proof = id(5);
const pdf = new TextEncoder().encode("%PDF-1.7\nwire confirmation");

function deps(over: Record<string, unknown> = {}, canAttach = true) {
  const stored = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name in over) return over[name] as { data: unknown; error: null };
    if (name === "mcp_cost_payment_proof_scope")
      return { data: { company_id: company, job_id: job, can_attach: canAttach }, error: null };
    if (name === "mcp_cost_payment_proof_link")
      return { data: { id: args._id, filename: args._filename }, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  const d: ProofDeps & { stored: Map<string, Uint8Array>; calls: string[]; removed: string[] } = {
    stored,
    calls,
    removed: [],
    member: async () => ({ rpc, verified: true }),
    put: async (path, bytes) => {
      stored.set(path, bytes);
      return { error: null };
    },
    remove: async (path) => {
      d.removed.push(path);
      stored.delete(path);
    },
    read: async (path) => stored.get(path)!,
    newId: () => proof,
  };
  return d;
}
const post = (body: BodyInit, filename = "wire confirmation.pdf", auth = true) =>
  new Request(
    `https://app.meetathena.io/api/payment-proof?${new URLSearchParams({ job, record, payment, filename })}`,
    { method: "POST", body, headers: auth ? { authorization: "Bearer token" } : {} },
  );

describe("payment proof upload", () => {
  it("stores the file at the scoped path and links it with the member's own token", async () => {
    const d = deps();
    const response = await handlePaymentProofUpload(post(pdf), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stored: true,
      proof: { id: proof, filename: "wire confirmation.pdf" },
    });
    expect([...d.stored.keys()]).toEqual([`${company}/${job}/${proof}/wire confirmation.pdf`]);
    expect(d.calls).toEqual(["mcp_cost_payment_proof_scope", "mcp_cost_payment_proof_link"]);
  });
  it("refuses without sign-in, without owner/AP, and for files that are not PDF/JPEG/PNG", async () => {
    expect((await handlePaymentProofUpload(post(pdf, "a.pdf", false), deps())).status).toBe(401);
    const pm = deps({}, false);
    expect((await handlePaymentProofUpload(post(pdf), pm)).status).toBe(403);
    expect(pm.stored.size).toBe(0);
    const word = deps();
    const r = await handlePaymentProofUpload(post("plain text", "notes.txt"), word);
    expect(r.status).toBe(415);
    expect(word.stored.size).toBe(0);
    const fake = deps();
    expect((await handlePaymentProofUpload(post("not a pdf", "check.pdf"), fake)).status).toBe(400);
    expect(fake.stored.size).toBe(0);
  });
  it("removes the stored bytes when linking fails or the file was already attached", async () => {
    const failed = deps({
      mcp_cost_payment_proof_link: {
        data: null,
        error: { message: "MCP_BAD:That payment is not recorded on this bill." },
      },
    });
    const r = await handlePaymentProofUpload(post(pdf), failed);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ message: "That payment is not recorded on this bill." });
    expect(failed.stored.size).toBe(0);
    const dup = deps({
      mcp_cost_payment_proof_link: { data: { id: id(99), filename: "first.pdf" }, error: null },
    });
    const again = await handlePaymentProofUpload(post(pdf), dup);
    expect(await again.json()).toMatchObject({ stored: true, duplicate: true });
    expect(dup.removed).toHaveLength(1);
  });
});

describe("payment proof download", () => {
  it("returns bytes only when they match the recorded fingerprint", async () => {
    const d = deps();
    const path = `${company}/${job}/${proof}/wire.pdf`;
    d.stored.set(path, pdf);
    const row = {
      id: proof,
      company_id: company,
      job_id: job,
      payment_id: payment,
      filename: "wire.pdf",
      mime_type: "application/pdf",
      storage_path: path,
      size_bytes: pdf.length,
      sha256: await sha256Hex(pdf),
    };
    const ok = deps({ mcp_cost_payment_proof_get: { data: row, error: null } });
    ok.stored.set(path, pdf);
    expect((await readPaymentProof("t", job, proof, ok)).bytes).toEqual(pdf);
    const changed = deps({
      mcp_cost_payment_proof_get: { data: { ...row, sha256: "0".repeat(64) }, error: null },
    });
    changed.stored.set(path, pdf);
    await expect(readPaymentProof("t", job, proof, changed)).rejects.toThrow(/fingerprint/);
    const moved = deps({
      mcp_cost_payment_proof_get: {
        data: { ...row, storage_path: `${company}/${job}/${id(77)}/wire.pdf` },
        error: null,
      },
    });
    await expect(readPaymentProof("t", job, proof, moved)).rejects.toThrow(/unavailable/);
  });
});
