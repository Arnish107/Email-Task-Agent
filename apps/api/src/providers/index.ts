import { config } from "../config.js";
import type { EmailProvider } from "./types.js";
import { fixtureProvider } from "./fixture.js";
import { gmailProvider } from "./gmail.js";
import { imapProvider } from "./imap.js";
import { microsoftProvider } from "./microsoft.js";

export function getProvider(name: string): EmailProvider {
  switch (name) {
    case "gmail":
      return gmailProvider;
    case "microsoft":
      return microsoftProvider;
    case "imap":
      return imapProvider;
    case "fixture":
      if (!config.enableFixtureProvider) {
        throw new Error("Fixture provider is disabled");
      }
      return fixtureProvider;
    default:
      throw new Error(`Unknown email provider: ${name}`);
  }
}
