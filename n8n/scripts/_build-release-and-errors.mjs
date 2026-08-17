// One-off authoring/import script — NOT part of the runtime pipeline. Builds
// release-on-approval.json and shared-error-handling.json and pushes them into
// a running local n8n instance via its REST API. See _build-manual-mode.mjs
// for the sibling manual-mode.json workflow and the same conventions.
import { runStepViaGithubActions } from "./_workflow-helpers.mjs";

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
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function id(prefix, n) {
  return `${prefix}-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

// ── release-on-approval.json ────────────────────────────────────────────
// Webhook trigger hit by review-dashboard's POST /approve (n8nWebhook.ts's
// notifyApproval) with the full ReviewState JSON as the body. Resumes the
// pipeline past the human gate: sets currentStep -> youtube-uploader, runs
// it, and marks the job completed (or failed, on error - see the Error
// Trigger wiring in shared-error-handling.json, which any workflow can
// reference by name).
function buildReleaseOnApproval() {
  const nodes = [];
  const connections = {};
  function connect(from, to) {
    connections[from] ??= { main: [[]] };
    connections[from].main[0].push({ node: to, type: "main", index: 0 });
  }

  nodes.push({
    parameters: { httpMethod: "POST", path: "release-on-approval", responseMode: "onReceived", options: {} },
    id: id("11111111", 1),
    name: "On approval webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 0],
    webhookId: "release-on-approval",
  });

  // review-dashboard's ReviewState (n8nWebhook.ts) arrives as the JSON POST
  // body; n8n's Webhook node nests it under `.body`.
  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        "const state = $input.first().json.body;",
        "if (state.status !== 'approved') throw new Error(`release-on-approval got a non-approved state for job ${state.jobId}: status=${state.status}`);",
        "const payload = { jobId: state.jobId, mode: 'manual', status: 'running', currentStep: 'youtube-uploader', niche: 'news-europe' };",
        "return [{ json: { jobId: state.jobId, updateJobB64: Buffer.from(JSON.stringify(payload)).toString('base64') } }];",
      ].join("\n"),
    },
    id: id("11111111", 2),
    name: "Build: youtube-uploader",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("On approval webhook", "Build: youtube-uploader");

  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/update-job.mts "{{ $json.updateJobB64 }}"` },
    id: id("11111111", 3),
    name: "job.json: youtube-uploader",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, 0],
  });
  connect("Build: youtube-uploader", "job.json: youtube-uploader");

  // Dispatched on GitHub Actions (08-upload-youtube.yml), not run locally —
  // same reasoning as every step in _workflow-helpers.mjs's
  // buildScriptGeneratorOnward: n8n only dispatches and polls. Needs a
  // "Job Context"-named node upstream since runStepViaGithubActions reads
  // the jobId from a node with that exact name; "Build: youtube-uploader"
  // already carries it under .jobId, so it's aliased here rather than
  // renamed (renaming would break the update-job.mts calls above/below that
  // reference it by its real name).
  nodes.push({
    parameters: { mode: "runOnceForAllItems", jsCode: "return [{ json: { jobId: $('Build: youtube-uploader').first().json.jobId } }];" },
    id: id("11111111", 9),
    name: "Job Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [660, 0],
  });
  connect("job.json: youtube-uploader", "Job Context");

  const gUpload = runStepViaGithubActions(11111111, 10, "youtube-uploader", "08-upload-youtube.yml");
  nodes.push(...gUpload.nodes);
  Object.entries(gUpload.connections).forEach(([from, conn]) => {
    connections[from] = conn;
  });
  connect("Job Context", gUpload.firstNodeName);

  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        "const jobId = $('Build: youtube-uploader').first().json.jobId;",
        "const payload = { jobId, mode: 'manual', status: 'completed', currentStep: 'youtube-uploader', niche: 'news-europe' };",
        "return [{ json: { updateJobB64: Buffer.from(JSON.stringify(payload)).toString('base64') } }];",
      ].join("\n"),
    },
    id: id("11111111", 5),
    name: "Build: completed",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [880, 0],
  });
  connect(gUpload.lastNodeName, "Build: completed");

  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/update-job.mts "{{ $json.updateJobB64 }}"` },
    id: id("11111111", 6),
    name: "job.json: completed",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [1100, 0],
  });
  connect("Build: completed", "job.json: completed");

  return { name: "Release on Approval", nodes, connections, settings: { executionOrder: "v1" } };
}

// ── shared-error-handling.json ──────────────────────────────────────────
// A separate workflow with an Error Trigger node - n8n calls this
// automatically for any OTHER workflow that names it in that workflow's
// Settings > "Error Workflow" field (manual-mode.json and
// release-on-approval.json both point here once imported for real; the
// REST-API-created copies in this verification pass predate that setting,
// since it's configured via the same "error workflow" picker the n8n UI
// exposes, not something the /rest/workflows create payload needs to carry).
// Marks job.json failed with the real error message and logs a notification
// (a Slack/email node is the natural next step in a hosted deployment - left
// as an HTTP-request placeholder here so this runs with zero external
// credentials during local verification).
function buildSharedErrorHandling() {
  const nodes = [];
  const connections = {};
  function connect(from, to) {
    connections[from] ??= { main: [[]] };
    connections[from].main[0].push({ node: to, type: "main", index: 0 });
  }

  nodes.push({
    parameters: {},
    id: id("22222222", 1),
    name: "On any workflow error",
    type: "n8n-nodes-base.errorTrigger",
    typeVersion: 1,
    position: [0, 0],
  });

  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        "const e = $input.first().json;",
        // Error Trigger's payload carries the FAILED execution's own input
        // data on e.execution.data - Job Context's jobId is what every node
        // downstream of it keys off, so it is reachable there regardless of
        // which node actually failed.
        "const jobId = e.workflow?.data?.resultData?.runData?.['Job Context']?.[0]?.data?.main?.[0]?.[0]?.json?.jobId",
        "  ?? e.execution?.data?.resultData?.runData?.['Job Context']?.[0]?.data?.main?.[0]?.[0]?.json?.jobId",
        "  ?? 'UNKNOWN';",
        "const message = e.execution?.error?.message || e.trigger?.error?.message || 'Unknown error';",
        "const payload = { jobId, mode: 'manual', status: 'failed', currentStep: null, niche: 'news-europe', error: String(message).slice(0, 500) };",
        "return [{ json: { jobId, message, updateJobB64: jobId === 'UNKNOWN' ? null : Buffer.from(JSON.stringify(payload)).toString('base64') } }];",
      ].join("\n"),
    },
    id: id("22222222", 2),
    name: "Extract failure",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("On any workflow error", "Extract failure");

  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/update-job.mts "{{ $json.updateJobB64 }}"` },
    id: id("22222222", 3),
    name: "job.json: failed",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [440, 0],
  });
  connect("Extract failure", "job.json: failed");

  // Optional, same reasoning as render-server's callback.ts and the
  // dashboard's n8nWebhook.ts: unconfigured/failing notification shouldn't
  // fail this workflow (job.json is already marked failed by the node above
  // regardless). N8N_ERROR_NOTIFY_WEBHOOK_URL is read from n8n's own process
  // env; point it at a Slack incoming webhook, a Telegram bot's sendMessage
  // URL, or any endpoint your own notification channel exposes.
  nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [
          {
            leftValue: "={{ $env.N8N_ERROR_NOTIFY_WEBHOOK_URL }}",
            rightValue: "",
            operator: { type: "string", operation: "notEmpty", singleValue: true },
          },
        ],
        combinator: "and",
      },
    },
    id: id("22222222", 4),
    name: "Notification configured?",
    type: "n8n-nodes-base.if",
    typeVersion: 2,
    position: [660, 0],
  });
  connect("job.json: failed", "Notification configured?");

  nodes.push({
    parameters: {
      method: "POST",
      url: "={{ $env.N8N_ERROR_NOTIFY_WEBHOOK_URL }}",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ jobId: $json.jobId, message: $json.message }) }}",
      options: { response: { response: { neverError: true } } },
    },
    id: id("22222222", 5),
    name: "Notify",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [880, 0],
  });
  connect("Notification configured?", "Notify");

  return { name: "Shared Error Handling", nodes, connections, settings: { executionOrder: "v1" } };
}

async function create(cookie, wf) {
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

async function main() {
  const cookie = await login();
  await create(cookie, buildReleaseOnApproval());
  await create(cookie, buildSharedErrorHandling());
}

export { buildReleaseOnApproval, buildSharedErrorHandling };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
