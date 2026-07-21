// GitHub tools — read files, commit to a branch, open PRs, check CI.
// Requires: GITHUB_TOKEN (fine-grained PAT). Optional: GITHUB_OWNER (defaults
// to igord29), GITHUB_ALLOWED_REPOS (comma-separated allow-list; blank = any
// repo under GITHUB_OWNER).
//
// Safety: commits ALWAYS go to a non-default branch; the bot never writes to
// main directly. Write calls are additionally approval-gated in bot.js.

const API = "https://api.github.com";
const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

const owner = () => process.env.GITHUB_OWNER || "igord29";

function assertRepoAllowed(repo) {
  const allow = process.env.GITHUB_ALLOWED_REPOS?.split(",").map(s => s.trim()).filter(Boolean);
  if (allow?.length && !allow.includes(repo)) {
    throw new Error(`Repo "${repo}" is not in GITHUB_ALLOWED_REPOS`);
  }
}

async function gh(method, path, body) {
  if (!process.env.GITHUB_TOKEN) throw new Error("GitHub is not configured — set GITHUB_TOKEN");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: TIMEOUT(20_000)
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${method} ${path} failed (${res.status}): ${data.message || ""}`);
  return data;
}

export async function getFile({ repo, path, ref }) {
  assertRepoAllowed(repo);
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await gh("GET", `/repos/${owner()}/${repo}/contents/${path}${q}`);
  if (Array.isArray(data)) {
    return { directory: data.map(f => ({ name: f.name, type: f.type, path: f.path })) };
  }
  const content = Buffer.from(data.content, "base64").toString("utf8");
  return { path: data.path, sha: data.sha, size: data.size, content: content.slice(0, 20_000) };
}

async function ensureBranch(repo, branch) {
  const repoInfo = await gh("GET", `/repos/${owner()}/${repo}`);
  const def = repoInfo.default_branch;
  if (branch === def) throw new Error(`Refusing to write directly to default branch "${def}" — use a feature branch`);
  try {
    await gh("GET", `/repos/${owner()}/${repo}/git/ref/heads/${branch}`);
  } catch {
    const baseRef = await gh("GET", `/repos/${owner()}/${repo}/git/ref/heads/${def}`);
    await gh("POST", `/repos/${owner()}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha
    });
  }
  return def;
}

export async function commitFile({ repo, branch, path, content, message }) {
  assertRepoAllowed(repo);
  await ensureBranch(repo, branch);
  // Need the existing file sha (if any) on that branch to update it
  let sha;
  try {
    const existing = await gh("GET", `/repos/${owner()}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    sha = existing.sha;
  } catch { /* new file */ }
  const data = await gh("PUT", `/repos/${owner()}/${repo}/contents/${path}`, {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {})
  });
  return { commit: data.commit?.sha, branch, path, html_url: data.content?.html_url };
}

export async function openPullRequest({ repo, branch, title, body }) {
  assertRepoAllowed(repo);
  const repoInfo = await gh("GET", `/repos/${owner()}/${repo}`);
  const pr = await gh("POST", `/repos/${owner()}/${repo}/pulls`, {
    title,
    head: branch,
    base: repoInfo.default_branch,
    body: body || ""
  });
  return { number: pr.number, url: pr.html_url, state: pr.state };
}

export async function checkCI({ repo, ref }) {
  assertRepoAllowed(repo);
  const repoInfo = await gh("GET", `/repos/${owner()}/${repo}`);
  const target = ref || repoInfo.default_branch;
  const data = await gh("GET", `/repos/${owner()}/${repo}/commits/${encodeURIComponent(target)}/check-runs`);
  const runs = (data.check_runs || []).map(r => ({
    name: r.name, status: r.status, conclusion: r.conclusion
  }));
  return { ref: target, total: data.total_count, runs: runs.slice(0, 10) };
}

export async function listIssues({ repo, state = "open" }) {
  assertRepoAllowed(repo);
  const data = await gh("GET", `/repos/${owner()}/${repo}/issues?state=${state}&per_page=10`);
  return data
    .filter(i => !i.pull_request)
    .map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url }));
}
