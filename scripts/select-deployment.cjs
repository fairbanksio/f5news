const { execFileSync } = require("node:child_process");
const { readFileSync, appendFileSync } = require("node:fs");

const components = ["infrastructure", "posts", "scraper", "subreddits", "webui", "scraper_verify"];
const result = (selected) => ({ ...selected, services: selected.posts || selected.scraper || selected.subreddits || selected.scraper_verify });
const fullSelection = () => result(Object.fromEntries(components.map((name) => [name, true])));
const scopes = ["full", "changed", "webui", "posts", "subreddits", "scraper", "infrastructure"];
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
const runGit = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

function selectDeployment(paths) {
  const selected = Object.fromEntries(components.map((name) => [name, false]));
  for (const file of paths) {
    if (file === ".github/workflows/deploy.yml" || file === "scripts/select-deployment.cjs" || file.startsWith(".github/actions/")) return fullSelection();
    if (/\.(?:md|mdx)$/i.test(file) || /^(?:docs|plans)\//.test(file) || /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(file) || /(?:^|\/)test_[^/]+\.py$/.test(file) || /^infrastructure\/tests\//.test(file)) continue;
    if (file.startsWith(".github/") || file === "AGENTS.md" || /^(?:LICENSE|CODEOWNERS)(?:\.|$)/.test(file)) continue;
    if (file.startsWith("infrastructure/")) return fullSelection();
    if ([".npmrc", ".nvmrc", ".node-version", "services/posts/subreddits.json"].includes(file)) {
      for (const name of ["posts", "scraper", "subreddits", "webui", "scraper_verify"]) selected[name] = true;
    } else if (file.startsWith("webui/")) selected.webui = true;
    else if (file.startsWith("services/posts/")) selected.posts = true;
    else if (file.startsWith("services/subreddits/")) selected.subreddits = true;
    else if (file.startsWith("services/scraper/") || file.startsWith("scripts/reddit-invisible/") || file.startsWith("scripts/reddit-stagehand/") || file === ".dockerignore") {
      selected.scraper = true;
      selected.scraper_verify = true;
    } else if (file === "scripts/check-browser-deployment.cjs") selected.scraper_verify = true;
    else if (file.startsWith("services/")) {
      for (const name of ["posts", "scraper", "subreddits", "scraper_verify"]) selected[name] = true;
    } else return fullSelection();
  }
  return result(selected);
}

function selectFromEvent({ eventName, event = {}, sha, scope = "full", baseline, git = runGit }) {
  if (!isSha(sha) || !["push", "workflow_dispatch"].includes(eventName)) return fullSelection();
  if (eventName === "workflow_dispatch") {
    if (!scopes.includes(scope) || ["full", "infrastructure"].includes(scope)) return fullSelection();
    if (scope !== "changed") return selectDeployment([scope === "webui" ? "webui/package.json" : `services/${scope}/package.json`]);
  }
  if (eventName === "push" && (!isSha(event.before) || /^0+$/.test(event.before))) return fullSelection();
  if (!isSha(baseline)) return fullSelection();
  try {
    git(["cat-file", "-e", `${baseline}^{commit}`]);
    git(["merge-base", "--is-ancestor", baseline, sha]);
    return selectDeployment(git(["diff", "--name-only", "--no-renames", "-z", baseline, sha, "--"]).split("\0").filter(Boolean));
  } catch {
    // An unavailable comparison must not silently skip a deployment.
    return fullSelection();
  }
}

async function findSuccessfulBaseline({ repository, token, targetSha, currentRunId, fetchImpl = fetch, git = runGit, now = Date.now }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") || !token || !isSha(targetSha)) return undefined;
  const deadline = now() + 25000;
  try {
    for (let page = 1; page <= 2; page++) {
      const remaining = deadline - now();
      if (remaining <= 0) return undefined;
      const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/deploy.yml/runs`);
      url.search = new URLSearchParams({ branch: "main", event: "push", status: "success", per_page: "20", page: String(page) });
      const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(Math.min(10000, remaining)) });
      if (!response.ok) return undefined;
      const payload = await response.json();
      if (!Array.isArray(payload.workflow_runs)) return undefined;
      for (const run of payload.workflow_runs.slice(0, 20)) {
        if (!run || String(run.id) === String(currentRunId) || run.event !== "push" || run.head_branch !== "main" || run.status !== "completed" || run.conclusion !== "success" || !isSha(run.head_sha)) continue;
        try {
          git(["cat-file", "-e", `${run.head_sha}^{commit}`]);
          git(["merge-base", "--is-ancestor", run.head_sha, targetSha]);
          return run.head_sha;
        } catch { /* A force-pushed or newer history is not this target's baseline. */ }
      }
      if (payload.workflow_runs.length < 20) return undefined;
    }
  } catch { /* Missing API/history access selects a full deployment. */ }
  return undefined;
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const scope = process.env.DEPLOY_SCOPE || "full";
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const baseline = eventName === "push" || (eventName === "workflow_dispatch" && scope === "changed")
    ? await findSuccessfulBaseline({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN,
      targetSha: process.env.GITHUB_SHA, currentRunId: process.env.GITHUB_RUN_ID }) : undefined;
  const selection = selectFromEvent({ eventName: process.env.GITHUB_EVENT_NAME,
    event, sha: process.env.GITHUB_SHA, scope, baseline });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(selection).map(([name, value]) => `${name}=${value}\n`).join(""));
  console.log(JSON.stringify(selection));
}

if (require.main === module) main().catch(() => { console.error("Unable to select deployment components"); process.exitCode = 1; });

module.exports = { selectDeployment, selectFromEvent, findSuccessfulBaseline };
