// One-off authoring/import script — NOT part of the runtime pipeline. Builds
// manual-mode.json's node graph and pushes it into a running local n8n
// instance via its REST API (session-cookie auth, same mechanism the n8n
// frontend itself uses). Run once to (re)create the workflow while iterating;
// the final validated export is what gets committed to n8n/workflows/.
//
// Everything from "Run script-generator" onward is shared with auto-mode.json
// (_build-auto-mode.mjs) via _workflow-helpers.mjs — only how the job starts
// differs between the two modes.
import { CD, buildScriptGeneratorOnward, create, id, login } from "./_workflow-helpers.mjs";

function buildWorkflow() {
  const nodes = [];
  const connections = {};
  function connect(from, to, fromOutput = 0) {
    connections[from] ??= { main: [] };
    connections[from].main[fromOutput] ??= [];
    connections[from].main[fromOutput].push({ node: to, type: "main", index: 0 });
  }

  // 1. Form Trigger
  nodes.push({
    parameters: {
      formTitle: "Start a Manual-Mode Video",
      formDescription: "Supplies the topic directly - trend-research is skipped in manual mode.",
      formFields: {
        values: [
          { fieldLabel: "Niche", fieldName: "niche", fieldType: "text", placeholder: "news-europe", requiredField: false },
          { fieldLabel: "Topic", fieldName: "topic", fieldType: "text", requiredField: true },
          { fieldLabel: "Angle", fieldName: "angle", fieldType: "text", requiredField: true },
          { fieldLabel: "Source URLs (one per line)", fieldName: "sourceUrls", fieldType: "textarea", requiredField: true },
          { fieldLabel: "Source Summaries (one per line)", fieldName: "sourceSummaries", fieldType: "textarea", requiredField: true },
        ],
      },
    },
    id: id(1, 1),
    name: "On form submission",
    type: "n8n-nodes-base.formTrigger",
    typeVersion: 2.2,
    position: [0, 0],
    webhookId: "manual-mode-start",
  });

  // 2. Job Context
  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        // Pure-JS UUID v4, not require('crypto') or globalThis.crypto: n8n's
        // Code node sandbox (@n8n/task-runner) disallows requiring Node
        // built-ins by default, AND doesn't expose the WebCrypto global
        // either - this needs zero built-ins so it works regardless.
        "function uuidv4() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }",
        "const f = $input.first().json;",
        "const jobId = uuidv4();",
        "const niche = (f.niche || 'news-europe').trim();",
        "const sourceUrls = String(f.sourceUrls || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);",
        "const sourceSummaries = String(f.sourceSummaries || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);",
        "const trend = { jobId, topic: f.topic, angle: f.angle, sourceUrls, sourceSummaries };",
        "function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }",
        "return [{ json: { jobId, niche, topic: f.topic, angle: f.angle, trendB64: b64(trend) } }];",
      ].join("\n"),
    },
    id: id(1, 2),
    name: "Job Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("On form submission", "Job Context");

  // 3. Write trend.json
  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/write-trend.mts "{{ $json.trendB64 }}"` },
    id: id(1, 3),
    name: "Write trend.json",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, 0],
  });
  connect("Job Context", "Write trend.json");

  // 4 onward: script-generator -> ... -> park at review (shared with auto-mode.json)
  const shared = buildScriptGeneratorOnward({ prefix: 2, startFrom: "Write trend.json", mode: "manual" });
  nodes.push(...shared.nodes);
  Object.entries(shared.connections).forEach(([from, conn]) => {
    connections[from] = conn;
  });

  return {
    name: "Manual Mode - Full Pipeline",
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };
}

export { buildWorkflow };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  login()
    .then((cookie) => create(cookie, buildWorkflow()))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
