// One-off authoring/import script — NOT part of the runtime pipeline. Builds
// manual-mode.json's node graph and pushes it into a running local n8n
// instance via its REST API (session-cookie auth, same mechanism the n8n
// frontend itself uses). Run once to (re)create the workflow while iterating;
// the final validated export is what gets committed to n8n/workflows/.
const N8N_URL = process.env.N8N_URL || "http://127.0.0.1:5678";
const EMAIL = "operator@localhost.local";
const PASSWORD = "LocalOnly-Pipeline2026!";
const REPO_ROOT = "E:\\Youtube Ai Automation Agent";
const CD = `cd /d "${REPO_ROOT}"`;

async function login() {
  const res = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return cookie;
}

function id(n) {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

// Every "advance job.json" step: a Code node computing the base64 update
// payload, feeding an Execute Command node that calls update-job.mts.
function jobUpdateNodes(n, name, currentStep, status = "running") {
  const codeId = id(n);
  const cmdId = id(n + 1);
  return {
    nodes: [
      {
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: `const ctx = $('Job Context').first().json;\nconst payload = { jobId: ctx.jobId, mode: 'manual', status: '${status}', currentStep: ${currentStep === null ? "null" : `'${currentStep}'`}, niche: ctx.niche };\nreturn [{ json: { ...ctx, updateJobB64: Buffer.from(JSON.stringify(payload)).toString('base64') } }];`,
        },
        id: codeId,
        name: `Build: ${name}`,
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [0, 0],
      },
      {
        parameters: { command: `=${CD} && npx tsx n8n/scripts/update-job.mts "{{ $json.updateJobB64 }}"` },
        id: cmdId,
        name: `job.json: ${name}`,
        type: "n8n-nodes-base.executeCommand",
        typeVersion: 1,
        position: [0, 0],
      },
    ],
    connections: { [`Build: ${name}`]: { main: [[{ node: `job.json: ${name}`, type: "main", index: 0 }]] } },
    firstNodeName: `Build: ${name}`,
    lastNodeName: `job.json: ${name}`,
  };
}

function runStepNode(nodeId, label, scriptRelPath) {
  return {
    parameters: { command: `=${CD} && npx tsx ${scriptRelPath} "{{ $('Job Context').first().json.jobId }}"` },
    id: nodeId,
    name: label,
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [0, 0],
  };
}

function buildWorkflow() {
  const nodes = [];
  const connections = {};
  function connect(from, to, fromOutput = 0) {
    connections[from] ??= { main: [] };
    connections[from].main[fromOutput] ??= [];
    connections[from].main[fromOutput].push({ node: to, type: "main", index: 0 });
  }
  function addBlock(block) {
    nodes.push(...block.nodes);
    Object.entries(block.connections).forEach(([from, conn]) => {
      connections[from] = conn;
    });
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
    id: id(1),
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
    id: id(2),
    name: "Job Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("On form submission", "Job Context");

  // 3. Write trend.json
  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/write-trend.mts "{{ $json.trendB64 }}"` },
    id: id(3),
    name: "Write trend.json",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, 0],
  });
  connect("Job Context", "Write trend.json");

  // 4. Create job.json (currentStep: script-generator)
  const b4 = jobUpdateNodes(4, "script-generator", "script-generator");
  addBlock(b4);
  connect("Write trend.json", b4.firstNodeName);

  // 5. Run script-generator
  nodes.push(runStepNode(id(6), "Run script-generator", "services/script-generator/src/index.ts"));
  connect(b4.lastNodeName, "Run script-generator");

  // ── Branch A: voiceover -> caption-sync ──
  const b7 = jobUpdateNodes(7, "voiceover", "voiceover");
  addBlock(b7);
  connect("Run script-generator", b7.firstNodeName);

  nodes.push(runStepNode(id(9), "Run voiceover", "services/voiceover/src/index.ts"));
  connect(b7.lastNodeName, "Run voiceover");

  const b10 = jobUpdateNodes(10, "caption-sync", "caption-sync");
  addBlock(b10);
  connect("Run voiceover", b10.firstNodeName);

  nodes.push(runStepNode(id(12), "Run caption-sync", "services/caption-sync/src/index.ts"));
  connect(b10.lastNodeName, "Run caption-sync");

  // ── Branch B (parallel): media-sourcing ──
  nodes.push(runStepNode(id(13), "Run media-sourcing", "services/media-sourcing/src/index.ts"));
  connect("Run script-generator", "Run media-sourcing");

  // ── Merge (barrier, not data-combination — both branches key off Job Context) ──
  nodes.push({
    parameters: { mode: "append" },
    id: id(14),
    name: "Voice+captions and media ready",
    type: "n8n-nodes-base.merge",
    typeVersion: 3.2,
    position: [0, 0],
  });
  connect("Run caption-sync", "Voice+captions and media ready", 0);
  connect("Run media-sourcing", "Voice+captions and media ready", 1);

  // 15. metadata-generator
  const b15 = jobUpdateNodes(15, "metadata-generator", "metadata-generator");
  addBlock(b15);
  connect("Voice+captions and media ready", b15.firstNodeName);

  nodes.push(runStepNode(id(17), "Run metadata-generator", "services/metadata-generator/src/index.ts"));
  connect(b15.lastNodeName, "Run metadata-generator");

  // 18. render (advance job.json, POST /render, poll)
  const b18 = jobUpdateNodes(18, "render", "render");
  addBlock(b18);
  connect("Run metadata-generator", b18.firstNodeName);

  nodes.push({
    parameters: {
      method: "POST",
      url: "={{ $env.RENDER_SERVER_URL || 'http://127.0.0.1:8080' }}/render",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{ $env.RENDER_SERVER_SHARED_SECRET }}" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ jobId: $('Job Context').first().json.jobId }) }}",
      options: {},
    },
    id: id(20),
    name: "Start render",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [0, 0],
  });
  connect(b18.lastNodeName, "Start render");

  nodes.push({
    parameters: { resume: "timeInterval", unit: "seconds", amount: 8 },
    id: id(21),
    name: "Poll delay",
    type: "n8n-nodes-base.wait",
    typeVersion: 1.1,
    position: [0, 0],
  });
  connect("Start render", "Poll delay");

  nodes.push({
    parameters: {
      method: "GET",
      url: "={{ $env.RENDER_SERVER_URL || 'http://127.0.0.1:8080' }}/jobs/{{ $('Job Context').first().json.jobId }}",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{ $env.RENDER_SERVER_SHARED_SECRET }}" }] },
      options: {},
    },
    id: id(22),
    name: "Check render status",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [0, 0],
  });
  connect("Poll delay", "Check render status");

  nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [{ leftValue: "={{ $json.status }}", rightValue: "running", operator: { type: "string", operation: "equals" } }],
        combinator: "and",
      },
    },
    id: id(23),
    name: "Still rendering?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [0, 0],
  });
  connect("Check render status", "Still rendering?");
  connect("Still rendering?", "Poll delay", 0); // true -> loop back

  nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [{ leftValue: "={{ $json.status }}", rightValue: "failed", operator: { type: "string", operation: "equals" } }],
        combinator: "and",
      },
    },
    id: id(24),
    name: "Render failed?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [0, 0],
  });
  connect("Still rendering?", "Render failed?", 1); // false (not running) -> check failure

  nodes.push({
    parameters: { errorMessage: "={{ 'render-server reported: ' + ($json.error || $json.result?.error || 'unknown render failure') }}" },
    id: id(25),
    name: "Fail on render error",
    type: "n8n-nodes-base.stopAndError",
    typeVersion: 1,
    position: [0, 0],
  });
  connect("Render failed?", "Fail on render error", 0); // true -> stop

  // 26. thumbnail-generator (false branch of Render failed? = success)
  const b26 = jobUpdateNodes(26, "thumbnail-generator", "thumbnail-generator");
  addBlock(b26);
  connect("Render failed?", b26.firstNodeName, 1);

  nodes.push(runStepNode(id(28), "Run thumbnail-generator", "services/thumbnail-generator/src/index.ts"));
  connect(b26.lastNodeName, "Run thumbnail-generator");

  // 29. Park for review
  const b29 = jobUpdateNodes(29, "review (parked)", "review");
  addBlock(b29);
  connect("Run thumbnail-generator", b29.firstNodeName);

  return {
    name: "Manual Mode - Full Pipeline",
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };
}

async function main() {
  const cookie = await login();
  const wf = buildWorkflow();
  const res = await fetch(`${N8N_URL}/rest/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(wf),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error("CREATE FAILED", res.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log("Created workflow:", body.data.id, body.data.name);
  console.log(`Open: ${N8N_URL}/workflow/${body.data.id}`);
}

export { buildWorkflow };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
