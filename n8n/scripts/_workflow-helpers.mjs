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

const GH_API = "https://api.github.com/repos/{{ $env.GITHUB_REPO }}";
const GH_HEADERS = [
  { name: "Authorization", value: "=Bearer {{ $env.GITHUB_TOKEN }}" },
  { name: "Accept", value: "application/vnd.github+json" },
  { name: "X-GitHub-Api-Version", value: "2022-11-28" },
];

/**
 * Dispatches a pipeline step as a GitHub Actions workflow_dispatch run and
 * polls until it completes, failing fast on a non-success conclusion.
 * Replaces runStepNode() everywhere the actual work is CPU/memory-heavy
 * (script-generator, voiceover, caption-sync, media-sourcing,
 * metadata-generator, render, thumbnail-generator) so n8n — which runs on
 * the operator's own machine — only ever does light HTTP polling, never the
 * work itself. Requires GITHUB_TOKEN (a PAT with Actions read/write on this
 * repo — the runtime's own secrets.GITHUB_TOKEN only works from inside a
 * running workflow, not for triggering one) and GITHUB_REPO ("owner/repo")
 * in n8n's own process environment.
 *
 * The dispatch-and-poll loop runs entirely inside ONE Code node (real
 * fetch() + setTimeout(), not n8n's graph-cycling via a Wait node looping
 * back through chained IF nodes). That first design was tried and abandoned:
 * across three real, live runs it reproducibly mis-routed a confirmed-true
 * boolean condition to the "false" output — root cause never pinned down
 * (the connections and condition JSON both looked correct against n8n's
 * documented IF-node shape) — while a single Code node's control flow is
 * plain JS with nothing left to mis-wire.
 *
 * workflow_dispatch has no synchronous response with a run id, so the run is
 * found afterward by listing recent workflow_dispatch runs for this workflow
 * file and taking the newest one created at/after the dispatch timestamp —
 * safe under this pipeline's one-job-at-a-time model (see voiceSelection.ts's
 * identical no-lock reasoning), not safe under concurrent dispatches of the
 * same workflow.
 */
export function runStepViaGithubActions(prefix, n, label, workflowFile, options = {}) {
  const maxWaitMinutes = options.maxWaitMinutes ?? 20;
  const pollName = `Poll: ${label}`;
  const succeededName = `Succeeded? ${label}`;
  const failName = `Failed: ${label}`;

  const nodes = [
    {
      parameters: {
        mode: "runOnceForAllItems",
        // Real code, not an n8n expression: {{ }} expressions and this
        // sandbox both read $env the same way once
        // N8N_BLOCK_ENV_ACCESS_IN_NODE=false is set (n8n 2.0+ default-denies
        // env access in both places for the same security reason Execute
        // Command is disabled by default).
        jsCode: [
          // Real bug, real fix: n8n's Code node sandbox is a restricted VM
          // with no global fetch (confirmed live: "ReferenceError: fetch is
          // not defined") — this.helpers.httpRequest is n8n's own supported
          // way to make HTTP calls from inside a Code node.
          `const GH_API = 'https://api.github.com/repos/' + $env.GITHUB_REPO;`,
          `const HEADERS = { Authorization: 'Bearer ' + $env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };`,
          `const jobId = $('Job Context').first().json.jobId;`,
          `const dispatchedAt = Date.now();`,
          ``,
          `await this.helpers.httpRequest({`,
          `  method: 'POST',`,
          `  url: GH_API + '/actions/workflows/${workflowFile}/dispatches',`,
          `  headers: HEADERS,`,
          `  body: { ref: 'master', inputs: { jobId } },`,
          `  json: true,`,
          `});`,
          ``,
          `const maxWaitMs = ${maxWaitMinutes} * 60 * 1000;`,
          `const pollIntervalMs = 15000;`,
          `let run = null;`,
          `while (Date.now() - dispatchedAt < maxWaitMs) {`,
          `  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));`,
          `  let body;`,
          `  try {`,
          `    body = await this.helpers.httpRequest({`,
          `      method: 'GET',`,
          `      url: GH_API + '/actions/workflows/${workflowFile}/runs?event=workflow_dispatch&per_page=5',`,
          `      headers: HEADERS,`,
          `      json: true,`,
          `    });`,
          `  } catch (e) { continue; }`,
          `  const candidates = (body.workflow_runs || [])`,
          `    .filter((r) => new Date(r.created_at).getTime() >= dispatchedAt - 5000)`,
          `    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));`,
          `  if (candidates.length > 0) {`,
          `    run = candidates[0];`,
          `    if (run.status === 'completed') break;`,
          `  }`,
          `}`,
          ``,
          `const succeeded = !!run && run.status === 'completed' && run.conclusion === 'success';`,
          `return [{ json: { succeeded, runId: run ? run.id : null, htmlUrl: run ? run.html_url : null, status: run ? run.status : null, conclusion: run ? run.conclusion : null } }];`,
        ].join("\n"),
      },
      id: id(prefix, n),
      name: pollName,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [0, 0],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
          conditions: [{ leftValue: "={{ $json.succeeded }}", rightValue: true, operator: { type: "boolean", operation: "equal" } }],
          combinator: "and",
        },
      },
      id: id(prefix, n + 1),
      name: succeededName,
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [0, 0],
    },
    {
      parameters: {
        errorMessage: `=GitHub Actions run for "${label}" did not succeed (status: {{ $json.status }}, conclusion: {{ $json.conclusion }}). See {{ $json.htmlUrl }}`,
      },
      id: id(prefix, n + 2),
      name: failName,
      type: "n8n-nodes-base.stopAndError",
      typeVersion: 1,
      position: [0, 0],
    },
  ];

  const connections = {
    [pollName]: { main: [[{ node: succeededName, type: "main", index: 0 }]] },
    [succeededName]: {
      main: [
        [], // true branch: caller connects this node's output 0 to whatever comes next
        [{ node: failName, type: "main", index: 0 }], // false -> stop
      ],
    },
  };

  return { nodes, connections, firstNodeName: pollName, lastNodeName: succeededName };
}

/**
 * Everything from script-generator onward: {voiceover -> caption-sync} and
 * media-sourcing in parallel -> metadata-generator -> render -> thumbnail-
 * generator -> park at review. Identical for manual and auto mode; only how
 * the job starts (and how it gets to "Run script-generator") differs
 * between the two callers.
 *
 * Every actual step runs on GitHub Actions (runStepViaGithubActions), not on
 * the machine n8n itself runs on — n8n only dispatches and polls. The one
 * exception is the tiny "job.json: X" state-update calls (jobUpdateNodes),
 * which stay local: each is a single small JSON write to R2, not real CPU
 * work, and there's no GitHub Actions workflow for them.
 *
 * `prefix` namespaces this block's node IDs so multiple call sites (or a
 * future third mode) can't collide; `startFrom` is the name of the
 * already-built node whose output should trigger "Run script-generator".
 */
export function buildScriptGeneratorOnward({ prefix, startFrom, mode }) {
  const nodes = [];
  const connections = {};
  // fromOutput: which of the SOURCE node's own output ports this comes from
  // (0 for every single-output node type used here; an IF node's two real
  // outputs are the only case this varies). toIndex: which INPUT port of a
  // multi-input node (a Merge node's two inputs) this feeds — independent of
  // fromOutput, and the thing that actually matters for merge fan-in.
  function connect(from, to, fromOutput = 0, toIndex = 0) {
    connections[from] ??= { main: [] };
    connections[from].main[fromOutput] ??= [];
    connections[from].main[fromOutput].push({ node: to, type: "main", index: toIndex });
  }
  function addBlock(block) {
    nodes.push(...block.nodes);
    Object.entries(block.connections).forEach(([from, conn]) => {
      connections[from] = conn;
    });
  }
  function addGhStep(block) {
    nodes.push(...block.nodes);
    Object.entries(block.connections).forEach(([from, conn]) => {
      connections[from] = conn;
    });
    return block;
  }

  // job.json: script-generator -> dispatch on GitHub Actions
  const b1 = jobUpdateNodes(prefix, 1, "script-generator", "script-generator", mode);
  addBlock(b1);
  connect(startFrom, b1.firstNodeName);

  const gScript = addGhStep(runStepViaGithubActions(prefix, 3, "script-generator", "02-generate-script.yml"));
  connect(b1.lastNodeName, gScript.firstNodeName);

  // ── Branch A: voiceover -> caption-sync ──
  const b11 = jobUpdateNodes(prefix, 11, "voiceover", "voiceover", mode);
  addBlock(b11);
  connect(gScript.lastNodeName, b11.firstNodeName); // "Succeeded?" true branch (output 0)

  const gVoice = addGhStep(runStepViaGithubActions(prefix, 13, "voiceover", "03-generate-voiceover.yml", { maxWaitMinutes: 40 }));
  connect(b11.lastNodeName, gVoice.firstNodeName);

  const b21 = jobUpdateNodes(prefix, 21, "caption-sync", "caption-sync", mode);
  addBlock(b21);
  connect(gVoice.lastNodeName, b21.firstNodeName);

  const gCaptions = addGhStep(runStepViaGithubActions(prefix, 23, "caption-sync", "04-generate-captions.yml", { maxWaitMinutes: 40 }));
  connect(b21.lastNodeName, gCaptions.firstNodeName);

  // ── Branch B (parallel): media-sourcing ──
  const gMedia = addGhStep(runStepViaGithubActions(prefix, 31, "media-sourcing", "05-source-media.yml"));
  connect(gScript.lastNodeName, gMedia.firstNodeName);

  // ── Merge (barrier, not data-combination — both branches key off Job Context) ──
  nodes.push({
    parameters: { mode: "append" },
    id: id(prefix, 39),
    name: "Voice+captions and media ready",
    type: "n8n-nodes-base.merge",
    typeVersion: 3.2,
    position: [0, 0],
  });
  connect(gCaptions.lastNodeName, "Voice+captions and media ready", 0, 0);
  connect(gMedia.lastNodeName, "Voice+captions and media ready", 0, 1);

  // metadata-generator
  const b40 = jobUpdateNodes(prefix, 40, "metadata-generator", "metadata-generator", mode);
  addBlock(b40);
  connect("Voice+captions and media ready", b40.firstNodeName);

  const gMeta = addGhStep(runStepViaGithubActions(prefix, 42, "metadata-generator", "06-generate-metadata.yml"));
  connect(b40.lastNodeName, gMeta.firstNodeName);

  // render
  const b50 = jobUpdateNodes(prefix, 50, "render", "render", mode);
  addBlock(b50);
  connect(gMeta.lastNodeName, b50.firstNodeName);

  // Render is the slowest step by far (real prior runs: well over an hour
  // at 1080p on a GitHub-hosted runner's CPU) — the default 20-minute cap
  // would fail out a genuinely-still-working render.
  const gRender = addGhStep(runStepViaGithubActions(prefix, 52, "render", "07-trigger-render.yml", { maxWaitMinutes: 180 }));
  connect(b50.lastNodeName, gRender.firstNodeName);

  // thumbnail-generator
  const b60 = jobUpdateNodes(prefix, 60, "thumbnail-generator", "thumbnail-generator", mode);
  addBlock(b60);
  connect(gRender.lastNodeName, b60.firstNodeName);

  const gThumb = addGhStep(runStepViaGithubActions(prefix, 62, "thumbnail-generator", "07b-generate-thumbnail.yml"));
  connect(b60.lastNodeName, gThumb.firstNodeName);

  // Park for review
  const b70 = jobUpdateNodes(prefix, 70, "review (parked)", "review", mode);
  addBlock(b70);
  connect(gThumb.lastNodeName, b70.firstNodeName);

  return { nodes, connections };
}
