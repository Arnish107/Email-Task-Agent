import { describe, expect, it } from "vitest";
import { inferImapSettings } from "../src/providers/imap.js";

describe("IMAP host inference", () => {
  it("infers common providers", () => {
    expect(inferImapSettings("a@gmail.com")?.host).toBe("imap.gmail.com");
    expect(inferImapSettings("a@outlook.com")?.host).toBe("outlook.office365.com");
    expect(inferImapSettings("a@yahoo.com")?.host).toBe("imap.mail.yahoo.com");
    expect(inferImapSettings("a@icloud.com")?.host).toBe("imap.mail.me.com");
  });

  it("returns null for unknown domains", () => {
    expect(inferImapSettings("boss@weird-county.example")).toBeNull();
  });
});
