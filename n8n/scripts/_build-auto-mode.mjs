// One-off authoring/import script — NOT part of the runtime pipeline. Mirrors
// _build-manual-mode.mjs: builds auto-mode.json's node graph and pushes it
// into a running local n8n instance via its REST API. The chain from
// "Run trend-research" onward is shared with manual-mode.json via
// _workflow-helpers.mjs's buildScriptGeneratorOnward — only how the job
// starts (a daily cron + a real trend-research run, instead of a form +
// direct trend.json write) differs.
import { CD, buildScriptGeneratorOnward, create, id, login, runStepViaGithubActions } from "./_workflow-helpers.mjs";

function buildWorkflow() {
  const nodes = [];
  const connections = {};
  function connect(from, to, fromOutput = 0) {
    connections[from] ??= { main: [] };
    connections[from].main[fromOutput] ??= [];
    connections[from].main[fromOutput].push({ node: to, type: "main", index: 0 });
  }

  // 1. Schedule Trigger — daily at 06:00 server time by default; adjust in
  // the n8n UI to whatever publish cadence the channel actually wants.
  nodes.push({
    parameters: {
      rule: { interval: [{ field: "days", daysInterval: 1, triggerAtHour: 6, triggerAtMinute: 0 }] },
    },
    id: id(1, 1),
    name: "Daily schedule",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [0, 0],
  });

  // 1b. Catch-up webhook — n8n's own schedule trigger only fires if n8n is
  // actually running at 06:00; if the PC was off, that day is silently lost.
  // check-auto-mode-catchup.mts (run by start-pipeline.bat on every startup)
  // POSTs here when it detects a missed run past the scheduled hour. Same
  // dual-trigger pattern manual-mode.json already uses (form + webhook both
  // feeding the same downstream flow). Path deliberately distinct from every
  // other webhook in this project (manual-mode-start[-api], release-on-
  // approval) so activating this workflow can't collide with those.
  nodes.push({
    parameters: { httpMethod: "POST", path: "auto-mode-catchup", responseMode: "onReceived", options: {} },
    id: id(1, 6),
    name: "Catch-up webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 160],
    webhookId: "auto-mode-catchup",
  });

  // 2. Job Context — no topic/angle/sources yet, unlike manual mode's Form:
  // trend-research is what discovers and writes those.
  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: [
        // Pure-JS UUID v4 — see manual-mode's Job Context node for why (no
        // require('crypto')/globalThis.crypto available in this sandbox).
        "function uuidv4() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }",
        "const jobId = uuidv4();",
        "const niche = ($env.TREND_NICHE || 'news-europe').trim();",
        "return [{ json: { jobId, niche } }];",
      ].join("\n"),
    },
    id: id(1, 2),
    name: "Job Context",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
  });
  connect("Daily schedule", "Job Context");
  connect("Catch-up webhook", "Job Context");

  // 2b. Record today as run — read by check-auto-mode-catchup.mts so a day
  // that already ran (via either trigger) is never double-triggered, and a
  // day that hasn't run yet (PC was off at 06:00) gets caught later. Must
  // run for BOTH trigger paths, so it sits right after Job Context rather
  // than being duplicated per-trigger.
  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/mark-auto-mode-run.mts` },
    id: id(1, 7),
    name: "Mark auto-mode run",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [330, 0],
  });
  connect("Job Context", "Mark auto-mode run");

  // 3. Create job.json (currentStep: trend-research, mode: auto)
  const codeId = id(1, 3);
  const cmdId = id(1, 4);
  nodes.push({
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: "const ctx = $('Job Context').first().json;\nconst payload = { jobId: ctx.jobId, mode: 'auto', status: 'running', currentStep: 'trend-research', niche: ctx.niche };\nreturn [{ json: { ...ctx, updateJobB64: Buffer.from(JSON.stringify(payload)).toString('base64') } }];",
    },
    id: codeId,
    name: "Build: trend-research",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [440, 0],
  });
  connect("Mark auto-mode run", "Build: trend-research");

  nodes.push({
    parameters: { command: `=${CD} && npx tsx n8n/scripts/update-job.mts "{{ $json.updateJobB64 }}"` },
    id: cmdId,
    name: "job.json: trend-research",
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: [660, 0],
  });
  connect("Build: trend-research", "job.json: trend-research");

  // 4. Run trend-research on GitHub Actions (see runStepViaGithubActions's
  // doc comment — n8n only dispatches and polls, never runs the work itself)
  const gTrend = runStepViaGithubActions(1, 5, "trend-research", "01-research-trending.yml");
  nodes.push(...gTrend.nodes);
  Object.entries(gTrend.connections).forEach(([from, conn]) => {
    connections[from] = conn;
  });
  connect("job.json: trend-research", gTrend.firstNodeName);

  // 5 onward: script-generator -> ... -> park at review (shared with manual-mode.json)
  const shared = buildScriptGeneratorOnward({ prefix: 2, startFrom: gTrend.lastNodeName, mode: "auto" });
  nodes.push(...shared.nodes);
  Object.entries(shared.connections).forEach(([from, conn]) => {
    connections[from] = conn;
  });

  return {
    name: "Auto Mode - Full Pipeline",
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
