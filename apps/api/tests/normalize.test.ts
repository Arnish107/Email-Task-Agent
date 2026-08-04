import { describe, expect, it } from "vitest";
import { htmlToPlainText, extractLinks, pickBodyText } from "../src/providers/normalize.js";
import { bodyHash } from "../src/crypto/tokens.js";

describe("email normalization", () => {
  it("converts HTML to plain text", () => {
    const text = htmlToPlainText("<p>Please <b>submit</b> the report.</p>");
    expect(text).toContain("submit");
    expect(text).not.toContain("<");
  });

  it("prefers plain text over HTML", () => {
    expect(
      pickBodyText({ plain: "plain body", html: "<p>html body</p>" }),
    ).toBe("plain body");
  });

  it("falls back to HTML-to-text", () => {
    expect(pickBodyText({ html: "<p>Only HTML</p>" })).toContain("Only HTML");
  });

  it("extracts links", () => {
    const links = extractLinks("See https://portal.dca.ga.gov/submit and done.");
    expect(links).toContain("https://portal.dca.ga.gov/submit");
  });

  it("hashes normalized bodies consistently", () => {
    expect(bodyHash("Hello   World")).toBe(bodyHash("hello world"));
  });
});
