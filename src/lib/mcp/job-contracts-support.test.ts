// ATH-0008: a contract value save that looked failed, and a contract PDF that never showed in Contracts.
import { ToolError } from "@lovable.dev/mcp-js";
import { describe, expect, it } from "vitest";
import { CONTRACTS_UNAVAILABLE, contractsOverview } from "../job-board-commercial";
import {
  LIST_UNAVAILABLE,
  LIST_UNAVAILABLE_AFTER_SAVE,
  jobContractsCard,
  readContracts,
  uploadedContractListing,
  type JobContract,
  type SavedContract,
} from "./tools/job-contract-tools";
import type { Sb } from "./guard";

const job = {
  job_id: "00000000-0000-4000-8000-000000000e20",
  job_number: "2810",
  name: "Willow Creek",
};
const doc = "00000000-0000-4000-8000-000000000e50";
const prime: JobContract = {
  id: "00000000-0000-4000-8000-0000000000a1",
  kind: "prime",
  counterparty: "Willow Creek HOA",
  value_cents: 46_262_000,
  status: "signed",
  signed_on: "2026-11-02",
  document_id: null,
  version: 1,
};
const saved: SavedContract = {
  ...prime,
  value_cents: 48_000_000,
  version: 2,
  contract_id: prime.id,
  changed: true,
  previous_status: "signed",
  status_changed: false,
};
const sbWith = (rows: () => { data: unknown; error: { message: string } | null }) =>
  ({ rpc: async () => rows() }) as unknown as Sb;

describe("readContracts", () => {
  it("returns the job's list when it reads", async () => {
    const list = { ...job, job_name: job.name, contracts: [prime] };
    const out = await readContracts(
      sbWith(() => ({ data: list, error: null })),
      job,
      null,
    );
    expect(out.contracts).toEqual([prime]);
    expect(out.list_unavailable).toBeUndefined();
  });

  it("never turns a good save into an error when the list read fails", async () => {
    const out = await readContracts(
      sbWith(() => ({
        data: null,
        error: { message: "canceling statement due to statement timeout" },
      })),
      job,
      saved,
    );
    expect(out.list_unavailable).toBe(true);
    expect(out.contracts).toHaveLength(1);
    expect(out.contracts[0]).toMatchObject({ id: prime.id, value_cents: 48_000_000, version: 2 });
    const card = jobContractsCard(out, saved, null);
    expect(card.next_move).toContain("Saved v2.");
  });

  it("says plainly that a list read failed and nothing changed", async () => {
    const failing = sbWith(() => ({ data: null, error: { message: "connection reset" } }));
    await expect(readContracts(failing, job, null)).rejects.toThrow(ToolError);
    await expect(readContracts(failing, job, null)).rejects.toThrow(LIST_UNAVAILABLE);
  });

  it("keeps the member-facing reason from the database", async () => {
    const scoped = sbWith(() => ({
      data: null,
      error: {
        message:
          "MCP_BAD:Contracts need full or contract access to the job. Your role can't see them.",
      },
    }));
    await expect(readContracts(scoped, job, null)).rejects.toThrow(
      "Contracts need full or contract access",
    );
  });

  it("explains the saved-but-unlisted state on the card", () => {
    expect(LIST_UNAVAILABLE_AFTER_SAVE).toMatch(/^The contract is saved\./);
  });
});

describe("uploadedContractListing", () => {
  it("says a stored file isn't on the contract list when the job has none", () => {
    const out = uploadedContractListing([], doc);
    expect(out.contract_list).toBe("not_listed");
    expect(out.member).toContain("isn't on the job's contract list yet");
    expect(out.host).toContain(`document_id ${doc}`);
    expect(out.host).toContain("after they confirm");
  });

  it("offers to link the file to the saved prime contract that has no copy", () => {
    const out = uploadedContractListing([prime], doc);
    expect(out.contract_list).toBe("link_to_prime");
    expect(out.member).toContain("Willow Creek HOA");
    expect(out.host).toContain(`contract_id ${prime.id}`);
    expect(out.host).toContain("expected_version 1");
  });

  it("knows when the file is already linked", () => {
    expect(uploadedContractListing([{ ...prime, document_id: doc }], doc).contract_list).toBe(
      "listed",
    );
  });

  it("ignores a voided prime and falls back when the list can't be read", () => {
    expect(uploadedContractListing([{ ...prime, status: "void" }], doc).contract_list).toBe(
      "not_listed",
    );
    expect(uploadedContractListing(null, doc).contract_list).toBe("unknown");
  });
});

describe("job board contracts section", () => {
  it("marks a failed contracts read as unavailable, not empty", () => {
    expect(contractsOverview(null, { orders: [] }, null).recordAvailable).toBe(false);
    expect(contractsOverview({ contracts: [] }, { orders: [] }, null).recordAvailable).toBe(true);
    expect(CONTRACTS_UNAVAILABLE).toContain("couldn't load");
    expect(CONTRACTS_UNAVAILABLE).not.toContain("No contracts");
  });
});
