import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EmailProvider, NormalizedEmail, ScanWindow } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/emails");

function loadFixtures(): NormalizedEmail[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(
        fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8"),
      ) as NormalizedEmail;
      return { ...raw, provider: "fixture" as const };
    });
}

export class FixtureProvider implements EmailProvider {
  readonly name = "fixture" as const;

  async listMessageIds(_accessToken: string, window: ScanWindow): Promise<string[]> {
    const cutoff = Date.now() - window.days * 24 * 60 * 60 * 1000;
    return loadFixtures()
      .filter((e) => new Date(e.sentAt).getTime() >= cutoff)
      .map((e) => e.messageId);
  }

  async fetchMessage(_accessToken: string, messageId: string): Promise<NormalizedEmail> {
    const email = loadFixtures().find((e) => e.messageId === messageId);
    if (!email) {
      throw new Error(`Fixture email not found: ${messageId}`);
    }
    return email;
  }
}

export const fixtureProvider = new FixtureProvider();

export function listAllFixtureEmails(): NormalizedEmail[] {
  return loadFixtures();
}
