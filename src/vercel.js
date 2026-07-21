// Vercel tools — deployment status, build logs, trigger a deploy.
// Requires: VERCEL_TOKEN for status/logs. VERCEL_DEPLOY_HOOK_URL for deploys
// (create one in Vercel: Project → Settings → Git → Deploy Hooks).
// Optional: VERCEL_TEAM_ID if the project lives in a team.

const API = "https://api.vercel.com";
const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

function teamQ(sep = "?") {
  return process.env.VERCEL_TEAM_ID ? `${sep}teamId=${process.env.VERCEL_TEAM_ID}` : "";
}

async function vc(path) {
  if (!process.env.VERCEL_TOKEN) throw new Error("Vercel is not configured — set VERCEL_TOKEN");
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    signal: TIMEOUT(20_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel GET ${path} failed (${res.status}): ${data.error?.message || ""}`);
  return data;
}

export async function deployStatus({ project } = {}) {
  let path = `/v6/deployments?limit=5${teamQ("&")}`;
  if (project) path += `&app=${encodeURIComponent(project)}`;
  const data = await vc(path);
  return (data.deployments || []).map(d => ({
    id: d.uid,
    project: d.name,
    state: d.state,           // READY | ERROR | BUILDING | QUEUED | CANCELED
    url: d.url ? `https://${d.url}` : null,
    created: new Date(d.createdAt).toISOString(),
    branch: d.meta?.githubCommitRef || null,
    commit_message: d.meta?.githubCommitMessage?.slice(0, 80) || null
  }));
}

export async function buildLogs({ deployment_id }) {
  const events = await vc(`/v3/deployments/${deployment_id}/events?limit=100${teamQ("&")}`);
  const lines = (Array.isArray(events) ? events : [])
    .filter(e => e.payload?.text)
    .map(e => e.payload.text.trimEnd());
  // Tail — the end of the log is where errors live
  return { lines: lines.slice(-40) };
}

export async function triggerDeploy() {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) throw new Error("No VERCEL_DEPLOY_HOOK_URL set — create a Deploy Hook in Vercel project settings");
  const res = await fetch(hook, { method: "POST", signal: TIMEOUT(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Deploy hook failed (${res.status})`);
  return { triggered: true, job: data.job?.id || null };
}
