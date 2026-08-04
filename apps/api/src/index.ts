import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Email Task Agent API listening on ${config.appBaseUrl}`);
  });
}

main().catch((err) => {
  console.error("Failed to start API", err);
  process.exit(1);
});
