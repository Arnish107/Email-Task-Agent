import { describe, expect, it } from "vitest";
import { fallbackExtract } from "../src/extraction/fallback.js";
import {
  validateExtractionResult,
  extractionResultSchema,
} from "../src/extraction/schema.js";
import { listAllFixtureEmails } from "../src/providers/fixture.js";
import type { NormalizedEmail } from "../src/providers/types.js";

function byId(id: string): NormalizedEmail {
  const email = listAllFixtureEmails().find((e) => e.messageId === id);
  if (!email) throw new Error(`missing fixture ${id}`);
  return email;
}

describe("extraction schema validation", () => {
  it("accepts valid extraction JSON", () => {
    const result = validateExtractionResult({
      containsTask: true,
      candidates: [
        {
          title: "Submit report",
          description: "Do the thing",
          deadline: "2026-09-30T23:59:59.000Z",
          submittedTo: "Georgia DCA",
          portalLink: null,
          priority: "medium",
          entityHint: "Troup County",
          assignedRoleHints: [],
          confidence: 0.9,
          evidence: [{ quote: "submit", reason: "action" }],
          missingFields: [],
        },
      ],
    });
    expect(result.candidates).toHaveLength(1);
  });

  it("rejects invalid confidence", () => {
    expect(() =>
      extractionResultSchema.parse({
        containsTask: true,
        candidates: [
          {
            title: "x",
            description: "y",
            deadline: null,
            submittedTo: null,
            portalLink: null,
            priority: "medium",
            entityHint: null,
            confidence: 2,
            evidence: [],
            missingFields: [],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("fallback extraction on fixtures", () => {
  it("extracts a clear task with due date", () => {
    const result = fallbackExtract(byId("fix-clear-task"));
    expect(result.containsTask).toBe(true);
    expect(result.candidates[0]?.deadline).toBeTruthy();
    expect(result.candidates[0]?.submittedTo).toMatch(/DCA/i);
    expect(result.candidates[0]?.portalLink).toContain("portal.dca.ga.gov");
  });

  it("surfaces missing deadline fields", () => {
    const result = fallbackExtract(byId("fix-no-deadline"));
    expect(result.containsTask).toBe(true);
    expect(result.candidates[0]?.deadline).toBeNull();
    expect(result.candidates[0]?.missingFields).toContain("deadline");
  });

  it("produces no task for FYI-only email", () => {
    const result = fallbackExtract(byId("fix-fyi-only"));
    expect(result.containsTask).toBe(false);
    expect(result.candidates).toHaveLength(0);
  });

  it("produces no task for newsletter", () => {
    const result = fallbackExtract(byId("fix-newsletter"));
    expect(result.containsTask).toBe(false);
  });

  it("captures portal link tasks", () => {
    const result = fallbackExtract(byId("fix-portal-link"));
    expect(result.containsTask).toBe(true);
    expect(result.candidates[0]?.portalLink).toContain("portal.dca.ga.gov");
  });

  it("extracts multiple tasks from one email", () => {
    const result = fallbackExtract(byId("fix-multi-task"));
    expect(result.containsTask).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });
});
