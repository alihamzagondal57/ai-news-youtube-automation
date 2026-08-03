// Shared node-graph builders for the pipeline workflows — used by both
// _build-manual-mode.mjs and _build-auto-mode.mjs, since everything from
// script-generator onward is IDENTICAL between the two modes (only how the
// job starts — a form vs. trend-research — differs). Keeping this in one
// place means a real change to the shared chain (e.g. a new step, a
// render-server contract change) can't drift between the two workflows.
export const N8N_URL = process.env.N8N_URL || "http://127.0.0.1:5678";
export const EMAIL = "operator@localhost.local";
export const PASSWORD = "LocalOnly-Pipeline2026!";
export const REPO_ROOT = "E:\\Youtube Ai Automation Agent";
export const CD = `cd /d "${REPO_ROOT}"`;

export async function login() {
  const res = await fetch(`${N8N_URL}/rest/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return cookie;
}

export async function create(cookie, wf) {
  const res = await fetch(`${N8N_URL}/rest/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(wf),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`CREATE FAILED (${wf.name})`, res.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(`Created: ${body.data.id} ${body.data.name}`);
  console.log(`Open: ${N8N_URL}/workflow/${body.data.id}`);
  return body.data;
}

export function id(prefix, n) {
  const p = String(prefix).padStart(8, "0");
  return `${p}-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

/** Every "advance job.json" step: a Code node computing the base64 update payload, feeding an Execute Command node that calls update-job.mts. */
export function jobUpdateNodes(prefix, n, name, currentStep, mode, status = "running") {
  const codeId = id(prefix, n);
  const cmdId = id(prefix, n + 1);
  return {
    nodes: [
      {
        parameters: {
          mode: "runOnceForAllItems",
          jsCode: `const ctx = $('Job Context').first().json;\nconst payload = { jobId: ctx.jobId, mode: '${mode}', status: '${status}', currentStep: ${currentStep === null ? "null" : `'${currentStep}'`}, niche: ctx.niche };\nreturn [{ json: { ...ctx, updateJobB64: Buffer.from(JSON.stringify(payload)).toString('base64') } }];`,
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

export function runStepNode(nodeId, label, scriptRelPath) {
  return {
    parameters: { command: `=${CD} && npx tsx ${scriptRelPath} "{{ $('Job Context').first().json.jobId }}"` },
    id: nodeId,
    name: label,
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [0, 0],
  };
}

/**
 * Everything from script-generator onward: {voiceover -> caption-sync} and
 * media-sourcing in parallel -> metadata-generator -> render (POST + poll +
 * fail-fast) -> thumbnail-generator -> park at review. Identical for manual
 * and auto mode; only how the job starts (and how it gets to "Run
 * script-generator") differs between the two callers.
 *
 * `prefix` namespaces this block's node IDs so multiple call sites (or a
 * future third mode) can't collide; `startFrom` is the name of the
 * already-built node whose output should trigger "Run script-generator".
 */
export function buildScriptGeneratorOnward({ prefix, startFrom, mode }) {
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

  // job.json: script-generator
  const b1 = jobUpdateNodes(prefix, 1, "script-generator", "script-generator", mode);
  addBlock(b1);
  connect(startFrom, b1.firstNodeName);

  nodes.push(runStepNode(id(prefix, 3), "Run script-generator", "services/script-generator/src/index.ts"));
  connect(b1.lastNodeName, "Run script-generator");

  // ── Branch A: voiceover -> caption-sync ──
  const b4 = jobUpdateNodes(prefix, 4, "voiceover", "voiceover", mode);
  addBlock(b4);
  connect("Run script-generator", b4.firstNodeName);

  nodes.push(runStepNode(id(prefix, 6), "Run voiceover", "services/voiceover/src/index.ts"));
  connect(b4.lastNodeName, "Run voiceover");

  const b7 = jobUpdateNodes(prefix, 7, "caption-sync", "caption-sync", mode);
  addBlock(b7);
  connect("Run voiceover", b7.firstNodeName);

  nodes.push(runStepNode(id(prefix, 9), "Run caption-sync", "services/caption-sync/src/index.ts"));
  connect(b7.lastNodeName, "Run caption-sync");

  // ── Branch B (parallel): media-sourcing ──
  nodes.push(runStepNode(id(prefix, 10), "Run media-sourcing", "services/media-sourcing/src/index.ts"));
  connect("Run script-generator", "Run media-sourcing");

  // ── Merge (barrier, not data-combination — both branches key off Job Context) ──
  nodes.push({
    parameters: { mode: "append" },
    id: id(prefix, 11),
    name: "Voice+captions and media ready",
    type: "n8n-nodes-base.merge",
    typeVersion: 3.2,
    position: [0, 0],
  });
  connect("Run caption-sync", "Voice+captions and media ready", 0);
  connect("Run media-sourcing", "Voice+captions and media ready", 1);

  // metadata-generator
  const b12 = jobUpdateNodes(prefix, 12, "metadata-generator", "metadata-generator", mode);
  addBlock(b12);
  connect("Voice+captions and media ready", b12.firstNodeName);

  nodes.push(runStepNode(id(prefix, 14), "Run metadata-generator", "services/metadata-generator/src/index.ts"));
  connect(b12.lastNodeName, "Run metadata-generator");

  // render (advance job.json, POST /render, poll)
  const b15 = jobUpdateNodes(prefix, 15, "render", "render", mode);
  addBlock(b15);
  connect("Run metadata-generator", b15.firstNodeName);

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
    id: id(prefix, 17),
    name: "Start render",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [0, 0],
  });
  connect(b15.lastNodeName, "Start render");

  nodes.push({
    parameters: { resume: "timeInterval", unit: "seconds", amount: 8 },
    id: id(prefix, 18),
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
    id: id(prefix, 19),
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
    id: id(prefix, 20),
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
    id: id(prefix, 21),
    name: "Render failed?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [0, 0],
  });
  connect("Still rendering?", "Render failed?", 1); // false (not running) -> check failure

  nodes.push({
    parameters: { errorMessage: "={{ 'render-server reported: ' + ($json.error || $json.result?.error || 'unknown render failure') }}" },
    id: id(prefix, 22),
    name: "Fail on render error",
    type: "n8n-nodes-base.stopAndError",
    typeVersion: 1,
    position: [0, 0],
  });
  connect("Render failed?", "Fail on render error", 0); // true -> stop

  // thumbnail-generator (false branch of Render failed? = success)
  const b23 = jobUpdateNodes(prefix, 23, "thumbnail-generator", "thumbnail-generator", mode);
  addBlock(b23);
  connect("Render failed?", b23.firstNodeName, 1);

  nodes.push(runStepNode(id(prefix, 25), "Run thumbnail-generator", "services/thumbnail-generator/src/index.ts"));
  connect(b23.lastNodeName, "Run thumbnail-generator");

  // Park for review
  const b26 = jobUpdateNodes(prefix, 26, "review (parked)", "review", mode);
  addBlock(b26);
  connect("Run thumbnail-generator", b26.firstNodeName);

  return { nodes, connections };
}
