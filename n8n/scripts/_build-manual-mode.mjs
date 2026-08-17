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
  function connect(from, to, fromOutput = 0, toIndex = 0) {
    connections[from] ??= { main: [] };
    connections[from].main[fromOutput] ??= [];
    connections[from].main[fromOutput].push({ node: to, type: "main", index: toIndex });
  }

  // 1a. Form Trigger — for starting a run directly from n8n's own UI.
  nodes.push({
    parameters: {
      formTitle: "Start a Manual-Mode Video",
      formDescription: "Supplies the topic directly - trend-research is skipped in manual mode.",
      formFields: {
        values: [
          { fieldLabel: "Niche", fieldName: "niche", fieldType: "text", placeholder: "news-europe", requiredField: false },
          { fieldLabel: "Topic", fieldName: "topic", fieldType: "text", requiredField: true },
          { fieldLabel: "Angle", fieldName: "angle", fieldType: "text", requiredField: true },
          { fieldLabel: "Source URLs (one per line)", fieldName: "sourceUrls", fieldType: "textarea", requiredField: false },
          { fieldLabel: "Source Summaries (one per line)", fieldName: "sourceSummaries", fieldType: "textarea", requiredField: false },
          { fieldLabel: "Resolution (480p/720p/1080p/2k/4k)", fieldName: "resolution", fieldType: "text", placeholder: "1080p", requiredField: false },
        ],
      },
    },
    id: id(1, 1),
    name: "On form submission",
    type: "n8n-nodes-base.formTrigger",
    typeVersion: 2.2,
    position: [0, -120],
    webhookId: "manual-mode-start",
  });

  // 1b. Plain webhook — for review-dashboard's "New job" screen to call
  // programmatically (same JSON shape as the form's fields, just as a real
  // POST body under .body instead of multipart form fields). Both triggers
  // converge on the same "Job Context" node below, so there is exactly one
  // place that decides what a manual job actually is, regardless of which
  // door it came through.
  nodes.push({
    // path must NOT be "manual-mode-start" — the form trigger above already
    // resolves to that path via its own webhookId, and n8n refuses to
    // publish a workflow whose own two triggers collide on the same path
    // (confirmed by a real "Conflicting Webhook Path" error naming this
    // workflow against itself, not another workflow, when this used to
    // match).
    parameters: { httpMethod: "POST", path: "manual-mode-start-api", responseMode: "onReceived", options: {} },
    id: id(1, 6),
    name: "On webhook submission",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 120],
    webhookId: "manual-mode-start-api",
  });

  // 2. Job Context — normalizes either trigger's input shape into one.
  const RESOLUTION_PRESETS_JS =
    "{'480p':{width:854,height:480},'720p':{width:1280,height:720},'1080p':{width:1920,height:1080},'2k':{width:2560,height:1440},'4k':{width:3840,height:2160}}";
  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        // Pure-JS UUID v4, not require('crypto') or globalThis.crypto: n8n's
        // Code node sandbox (@n8n/task-runner) disallows requiring Node
        // built-ins by default, AND doesn't expose the WebCrypto global
        // either - this needs zero built-ins so it works regardless.
        "function uuidv4() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }",
        // The webhook trigger nests the real POST body under .body; the form
        // trigger's fields land directly on the item — this is the one place
        // that tells the two apart.
        "const raw = $input.first().json;",
        "const f = raw.body ?? raw;",
        // review-dashboard's "New job" screen generates the id itself (so it
        // can redirect the operator to a status page before this workflow
        // finishes) and passes it in; the form trigger has no id to pass, so
        // this is the only path that still generates one.
        "const jobId = f.jobId || uuidv4();",
        "const niche = (f.niche || 'news-europe').trim();",
        "const sourceUrls = String(f.sourceUrls || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);",
        "const sourceSummaries = String(f.sourceSummaries || '').split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);",
        "const trend = { jobId, topic: f.topic, angle: f.angle || f.topic, sourceUrls, sourceSummaries };",
        `const RESOLUTION_PRESETS = ${RESOLUTION_PRESETS_JS};`,
        "const resolution = RESOLUTION_PRESETS[String(f.resolution || '1080p').trim().toLowerCase()] || RESOLUTION_PRESETS['1080p'];",
        "function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }",
        "return [{ json: { jobId, niche, topic: f.topic, angle: f.angle || f.topic, trendB64: b64(trend), reviewStateB64: b64({ jobId, resolution }) } }];",
      ].join("\n"),
    },
    id: id(1, 2),
    name: "Job Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("On form submission", "Job Context");
  connect("On webhook submission", "Job Context");

  // 3a. Write trend.json
  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/write-trend.mts "{{ $json.trendB64 }}"` },
    id: id(1, 3),
    name: "Write trend.json",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, -60],
  });
  connect("Job Context", "Write trend.json");

  // 3b. Write review-state.json (carries the resolution override through to
  // render-server via reviewOverrides.ts — see the New Job screen's own
  // resolution selector, which this replaces the local-execution path of).
  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/write-review-state.mts "{{ $json.reviewStateB64 }}"` },
    id: id(1, 7),
    name: "Write review-state.json",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, 60],
  });
  connect("Job Context", "Write review-state.json");

  // Barrier: both writes must land before script-generator reads anything.
  nodes.push({
    parameters: { mode: "append" },
    id: id(1, 8),
    name: "Job seeded",
    type: "n8n-nodes-base.merge",
    typeVersion: 3.2,
    position: [660, 0],
  });
  connect("Write trend.json", "Job seeded", 0, 0);
  connect("Write review-state.json", "Job seeded", 0, 1);

  // 4 onward: script-generator -> ... -> park at review (shared with auto-mode.json)
  const shared = buildScriptGeneratorOnward({ prefix: 2, startFrom: "Job seeded", mode: "manual" });
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
