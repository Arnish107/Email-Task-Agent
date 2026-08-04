import { describe, expect, it } from "vitest";
import {
  buildImportantGmailQuery,
  isImportantCandidate,
  isImportantEmail,
  scoreEmailImportance,
} from "../src/extraction/importance.js";
import { listAllFixtureEmails } from "../src/providers/fixture.js";

function byId(id: string) {
  const email = listAllFixtureEmails().find((e) => e.messageId === id);
  if (!email) throw new Error(`missing fixture ${id}`);
  return email;
}

describe("importance filtering", () => {
  it("keeps clear compliance tasks", () => {
    expect(isImportantEmail(byId("fix-clear-task"))).toBe(true);
    expect(isImportantEmail(byId("fix-portal-link"))).toBe(true);
    expect(isImportantEmail(byId("fix-multi-task"))).toBe(true);
  });

  it("drops FYI and newsletter noise", () => {
    expect(isImportantEmail(byId("fix-fyi-only"))).toBe(false);
    expect(isImportantEmail(byId("fix-newsletter"))).toBe(false);
  });

  it("builds a selective Gmail query", () => {
    const q = buildImportantGmailQuery(7);
    expect(q).toContain("newer_than:7d");
    expect(q).toContain("action required");
    expect(q).toContain("-category:promotions");
  });

  it("keeps high-confidence or deadline+agency candidates", () => {
    expect(
      isImportantCandidate({
        title: "Submit report",
        confidence: 0.8,
        deadline: null,
        submittedTo: null,
      }),
    ).toBe(true);
    expect(
      isImportantCandidate({
        title: "Submit report",
        confidence: 0.6,
        deadline: "2026-09-30T23:59:59.000Z",
        submittedTo: "Georgia DCA",
      }),
    ).toBe(true);
    expect(
      isImportantCandidate({
        title: "Hello",
        confidence: 0.4,
        deadline: null,
        submittedTo: null,
      }),
    ).toBe(false);
  });

  it("scores action subjects highly", () => {
    const score = scoreEmailImportance(byId("fix-clear-task"));
    expect(score.score).toBeGreaterThanOrEqual(4);
    expect(score.important).toBe(true);
  });
});
