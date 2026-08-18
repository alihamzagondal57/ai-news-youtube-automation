import { config } from "./config.js";

/**
 * Talks to n8n's own REST management API to read/flip the Auto Mode
 * workflow's active state — the one thing the dashboard needs to actually
 * MANAGE in n8n rather than just call a webhook it exposes (see
 * n8nWebhook.ts / newJob.ts for the webhook-only integrations).
 *
 * Looked up by NAME ("Auto Mode - Full Pipeline"), not a hardcoded workflow
 * ID: that ID is not stable — n8n's own /rest/workflows POST always creates
 * a new workflow rather than updating one in place (see
 * n8n/scripts/_workflow-helpers.mjs's `create`), so re-importing an edited
 * auto-mode.json genuinely changes the ID. Re-resolving by name on every
 * call costs one extra request but survives that.
 */

const WORKFLOW_NAME = "Auto Mode - Full Pipeline";

let cachedCookie: string | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${config.n8nUrl}/rest/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: config.n8nAdminEmail, password: config.n8nAdminPassword }),
  });
  if (!res.ok) throw new Error(`n8n login failed: ${res.status} ${await res.text().catch(() => "")}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("n8n login succeeded but returned no session cookie");
  return cookie;
}

/** Runs `fn` with a cached session cookie, logging in fresh once if the cached one has expired (n8n returns 401). */
async function withSession<T>(fn: (cookie: string) => Promise<Response>): Promise<Response> {
  cachedCookie ??= await login();
  let res = await fn(cachedCookie);
  if (res.status === 401) {
    cachedCookie = await login();
    res = await fn(cachedCookie);
  }
  return res;
}

interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  versionId: string;
}

async function findAutoModeWorkflow(): Promise<N8nWorkflowSummary> {
  const res = await withSession((cookie) => fetch(`${config.n8nUrl}/rest/workflows`, { headers: { cookie } }));
  if (!res.ok) throw new Error(`Listing n8n workflows failed: ${res.status}`);
  const body = (await res.json()) as { data: N8nWorkflowSummary[] };
  const workflow = body.data.find((w) => w.name === WORKFLOW_NAME);
  if (!workflow) throw new Error(`No n8n workflow named "${WORKFLOW_NAME}" found`);
  return workflow;
}

export async function getAutoModeStatus(): Promise<{ active: boolean }> {
  const workflow = await findAutoModeWorkflow();
  return { active: workflow.active };
}

export async function setAutoModeActive(active: boolean): Promise<{ active: boolean }> {
  const workflow = await findAutoModeWorkflow();
  const action = active ? "activate" : "deactivate";
  const res = await withSession((cookie) =>
    fetch(`${config.n8nUrl}/rest/workflows/${workflow.id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ versionId: workflow.versionId }),
    }),
  );
  if (!res.ok) throw new Error(`n8n ${action} failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { data: { active: boolean } };
  return { active: body.data.active };
}
