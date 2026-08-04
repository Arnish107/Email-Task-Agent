import { describe, expect, it } from "vitest";
import {
  findCandidateDuplicates,
  isCandidateDuplicate,
} from "../src/duplicates/detect.js";
import { bodyHash } from "../src/crypto/tokens.js";
import { listAllFixtureEmails } from "../src/providers/fixture.js";
import { buildExportItem } from "../src/export/task.js";
import { matchEntity, strongEntityMatch } from "../src/entity/mapping.js";

describe("duplicate detection", () => {
  it("detects source duplicates via body hash", () => {
    const clear = listAllFixtureEmails().find((e) => e.messageId === "fix-clear-task")!;
    const forwarded = listAllFixtureEmails().find(
      (e) => e.messageId === "fix-forwarded-duplicate",
    )!;
    expect(bodyHash(clear.bodyText)).toBe(bodyHash(forwarded.bodyText));
  });

  it("detects candidate duplicates by title/entity/deadline/submittedTo", () => {
    const a = {
      title: "Submit FY2026 report",
      entityHint: "Troup County",
      deadline: "2026-09-30T23:59:59.000Z",
      submittedTo: "Georgia DCA",
    };
    const existing = [
      {
        id: "1",
        status: "needs_review",
        ...a,
      },
    ];
    expect(isCandidateDuplicate(a, existing[0])).toBe(true);
    expect(findCandidateDuplicates(a, existing)).toHaveLength(1);
  });
});

describe("entity mapping", () => {
  it("exact matches county names", () => {
    const match = matchEntity("Troup County");
    expect(match?.entity.id).toBe("entity-troup");
    expect(match?.method).toBe("exact");
  });

  it("does not auto-fill from weak fuzzy matches", () => {
    expect(strongEntityMatch("Somewhere Else")).toBeNull();
  });
});

describe("export contract", () => {
  it("exports a valid task payload from an approved candidate", () => {
    const item = buildExportItem({
      id: "cand-1",
      title: "Submit FY2026 report",
      description: "Extracted summary",
      county_id: "entity-troup",
      deadline: "2026-09-30T23:59:59.000Z",
      submitted_to: "Georgia DCA",
      portal_link: "https://portal.dca.ga.gov/submit/cdbg",
      priority: "medium",
      assigned_role_hints: ["finance"],
      evidence: [{ quote: "submit", reason: "action" }],
      confidence: 0.86,
      provider_message_id: "msg-1",
      source_thread_id: "thr-1",
      source_subject: "Action required",
      source_sender: "reports@dca.ga.gov",
      source_sent_at: "2026-07-28T14:30:00.000Z",
      reviewed_by: "admin@example.com",
      reviewed_at: "2026-08-02T12:00:00.000Z",
      provider: "gmail",
    });

    expect(item.task.title).toBe("Submit FY2026 report");
    expect(item.task.countyId).toBe("entity-troup");
    expect(item.task.priority).toBe("medium");
    expect(item.source.type).toBe("email");
    expect(item.review.approvedBy).toBe("admin@example.com");
  });

  it("rejects export without required fields", () => {
    expect(() =>
      buildExportItem({
        id: "cand-2",
        title: "X",
        description: "Y",
        county_id: null,
        deadline: null,
        submitted_to: null,
        portal_link: null,
        priority: "medium",
        assigned_role_hints: [],
        evidence: [],
        confidence: 0.5,
        provider_message_id: "m",
        source_thread_id: null,
        source_subject: "s",
        source_sender: "a@b.c",
        source_sent_at: null,
        reviewed_by: null,
        reviewed_at: null,
        provider: "fixture",
      }),
    ).toThrow(/countyId/i);
  });
});
