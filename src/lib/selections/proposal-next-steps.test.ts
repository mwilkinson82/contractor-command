import { describe, expect, it } from "vitest";
import { customerProposal } from "./proposal";
import { notForCustomerWording, proposalNextSteps } from "./proposal-next-steps";
import { willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";

const view = (mutate?: (b: ReturnType<typeof willowCreekTypeE>) => void) => {
  const b = willowCreekTypeE();
  mutate?.(b);
  return customerProposal(b, 4);
};
const ids = (s: { id: string }[]) => s.map((x) => x.id);
const someone = {
  customers: [{ name: "Dana Park", email: "d@example.com" }],
  open_on_client_page: false,
  chosen_on_client_page: null,
};

describe("next steps after a Good, Better, Best preview", () => {
  it("asks to fix test wording and add terms before anything goes out", () => {
    const v = view((b) => {
      b.proposal.title = "Track lighting options (TEST)";
      b.proposal.intro = "Not for a customer.";
      b.proposal.terms = "";
      b.proposal.valid_until = null;
    });
    expect(notForCustomerWording(v)).toBe("TEST");
    const steps = proposalNextSteps(v, 4, someone);
    expect(ids(steps)).toEqual([
      "fix_wording",
      "add_terms",
      "set_change_terms",
      "send_to_client_page",
      "view_only_link",
    ]);
    expect(steps[1].detail).toContain("No date the prices are good until and no terms");
    expect(steps[2].detail).toContain("no added time and no extra charge");
  });

  it("drops the time step once the member has confirmed it", () => {
    expect(ids(proposalNextSteps(view(), 4, someone, true))).not.toContain("set_change_terms");
  });

  it("says it replaces the proposal already waiting on the client page", () => {
    const steps = proposalNextSteps(view(), 4, { ...someone, open_on_client_page: true }, true);
    expect(steps[0]).toMatchObject({
      id: "send_to_client_page",
      label: "Update it on their client page",
    });
  });

  it("stops offering to send once the customer has chosen", () => {
    const steps = proposalNextSteps(view(), 4, { ...someone, chosen_on_client_page: "better" });
    expect(ids(steps)).toEqual(["carry_choice"]);
    expect(steps[0].label).toBe("Carry Better into the estimate");
  });

  it("never offers the view-only link as the way to get an approval", () => {
    const link = proposalNextSteps(view(), 4, someone).find((s) => s.id === "view_only_link")!;
    expect(link.detail).toContain("no one can choose or approve on it");
  });
});
