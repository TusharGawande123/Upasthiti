// The on-screen plan for a bulk action must follow the server's rules (spec §7 rule 3).
import { describe, expect, it } from "vitest";
import { cardRow } from "../../test/qr-card-fixtures";
import { doable, inParts, planCardAction, planIssue, skipped } from "./bulk-plan";

const NO_CARD = cardRow({ id: "e-1" }, null);
const ACTIVE = cardRow({ id: "e-2" }, { state: "active" });
const REVOKED = cardRow({ id: "e-3" }, { state: "revoked" });
const EXPIRED = cardRow({ id: "e-4" }, { state: "expired" });
const NOT_YET = cardRow({ id: "e-5" }, { state: "not_yet_valid" });
const FACE = cardRow({ id: "e-6", punch_method: "face" }, null);
const FACE_WITH_CARD = cardRow({ id: "e-7", punch_method: "face" }, { state: "active" });

describe("planIssue", () => {
  it("gives a card to QR people with no card or only a revoked one", () => {
    const plan = planIssue([NO_CARD, REVOKED]);

    expect(doable(plan).map((item) => item.row.employee.id)).toEqual(["e-1", "e-3"]);
    expect(skipped(plan)).toEqual([]);
  });

  it("skips people who punch by face, also those who still hold a card", () => {
    const plan = planIssue([FACE, FACE_WITH_CARD]);

    expect(plan.map((item) => item.skip)).toEqual(["EMPLOYEE_NOT_QR", "EMPLOYEE_NOT_QR"]);
  });

  it("never replaces a card that is working, expired or not yet valid", () => {
    const plan = planIssue([ACTIVE, EXPIRED, NOT_YET]);

    expect(plan.map((item) => item.skip)).toEqual([
      "QR_CARD_EXISTS",
      "QR_CARD_EXISTS",
      "QR_CARD_EXISTS",
    ]);
  });
});

describe("planCardAction (revoke and print)", () => {
  it("uses every card that is not revoked, whatever its dates", () => {
    const plan = planCardAction([ACTIVE, EXPIRED, NOT_YET]);

    expect(doable(plan)).toHaveLength(3);
  });

  it("skips people without a card and revoked cards, with the reason", () => {
    const plan = planCardAction([NO_CARD, REVOKED, ACTIVE]);

    expect(skipped(plan).map((item) => item.skip)).toEqual(["NO_CARD", "QR_CARD_REVOKED"]);
    expect(doable(plan).map((item) => item.row.employee.id)).toEqual(["e-2"]);
  });
});

describe("inParts", () => {
  it("cuts a list into parts of at most the given size, keeping the order", () => {
    const parts = inParts([1, 2, 3, 4, 5], 2);

    expect(parts).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("gives no parts for an empty list and one part for a short list", () => {
    expect(inParts([], 200)).toEqual([]);
    expect(inParts([1, 2], 200)).toEqual([[1, 2]]);
  });
});
