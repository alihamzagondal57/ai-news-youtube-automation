// Diagnostics: what the live provider chain currently is, which credentials are
// missing, and exactly how to obtain each one. No network calls, no keys printed.
import "dotenv/config";
import { buildProviderChain, providerStatus } from "../services/script-generator/src/providers/registry.ts";

const statuses = providerStatus();
const chain = buildProviderChain();

console.log("=".repeat(88));
console.log("SCRIPT-GENERATOR PROVIDER CHAIN");
console.log("=".repeat(88));
console.log(`Live fallback order: ${chain.length > 0 ? chain.map((p) => p.name).join("  ->  ") : "(EMPTY — generation will throw)"}`);
console.log("");
console.log("Validation thresholds are IDENTICAL for every provider. Rank sets order only;");
console.log("a lower-ranked model gets asked later, never judged more leniently.");
console.log("");

for (const { definition, configured, model } of statuses) {
  const state = definition.disabledReason ? "DISABLED" : configured ? "READY" : "NEEDS KEY";
  console.log("-".repeat(88));
  console.log(`[${definition.rank}] ${definition.label}   (${state})`);
  console.log(`     id:     ${definition.id}`);
  console.log(`     model:  ${model}   (override with ${definition.modelEnvKey})`);
  console.log(`     cost:   ${definition.cost}`);
  if (!configured) {
    console.log(`     env:    ${definition.envKey}  <-- NOT SET`);
    console.log(`     get it: ${definition.howToGetKey}`);
  } else {
    console.log(`     env:    ${definition.envKey}  (set)`);
  }
  if (definition.notes) console.log(`     note:   ${definition.notes}`);
  if (definition.disabledReason) {
    console.log(`     WHY DISABLED: ${definition.disabledReason}`);
  }
}

console.log("-".repeat(88));
const needed = statuses.filter((s) => !s.configured && !s.definition.disabledReason);
if (needed.length > 0) {
  console.log("\nKEYS STILL NEEDED, in priority order:");
  for (const { definition } of needed) {
    console.log(`  ${definition.envKey.padEnd(22)} ${definition.label}  —  ${definition.cost}`);
  }
} else {
  console.log("\nAll non-disabled providers are configured.");
}
console.log("");
