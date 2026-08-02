import { JobStore } from "@ai-news/shared";
import { config } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const store = JobStore.fromEnv();
  const app = buildServer(store);
  await app.listen({ port: config.port, host: "127.0.0.1" });
  console.log(`review-dashboard server listening on http://127.0.0.1:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
