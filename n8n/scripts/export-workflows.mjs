// Regenerates n8n/workflows/*.json from the authoring scripts in this
// directory — the .json files are the committed source of truth (importable
// directly into any n8n instance); these builder scripts are how they're
// produced and kept in sync when a node needs to change.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflow } from "./_build-manual-mode.mjs";
import { buildReleaseOnApproval, buildSharedErrorHandling } from "./_build-release-and-errors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "workflows");

function stripRuntimeFields(wf) {
  const { active, ...rest } = wf;
  return rest;
}

async function main() {
  const files = {
    "manual-mode.json": buildWorkflow(),
    "release-on-approval.json": buildReleaseOnApproval(),
    "shared-error-handling.json": buildSharedErrorHandling(),
  };
  for (const [file, wf] of Object.entries(files)) {
    const path = join(outDir, file);
    await writeFile(path, JSON.stringify(stripRuntimeFields(wf), null, 2) + "\n");
    console.log(`Wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
