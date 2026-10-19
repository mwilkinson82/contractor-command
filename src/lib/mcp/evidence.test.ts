import { describe, it, expect } from "vitest";
import { isVagueEvidence } from "./evidence";

describe("close evidence", () => {
  it.each(["we're good", "We are good.", "all set", "done", "ok", "it's handled", "taken care of", "", "Looks good"])("rejects %j", (t) => expect(isVagueEvidence(t)).toBe(true));
  it.each(["Approved submittal 07-210 rev 1", "COI #4471 received", "Jane Ruiz confirmed by email that LDs do not apply"])("accepts %j", (t) => expect(isVagueEvidence(t)).toBe(false));
});
