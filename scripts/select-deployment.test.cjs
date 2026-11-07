const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const yaml = require("../services/scraper/node_modules/js-yaml");
const { selectDeployment, selectFromEvent, findSuccessfulBaseline } = require("./select-deployment.cjs");

const selected = (paths) => Object.entries(selectDeployment(paths)).filter(([, value]) => value).map(([name]) => name).sort();
const full = ["infrastructure", "posts", "scraper", "scraper_verify", "services", "subreddits", "webui"];
const consumers = full.filter((name) => name !== "infrastructure");

test("frontend and individual service changes deploy only their owning component", () => {
  assert.deepEqual(selected(["webui/src/App.jsx"]), ["webui"]);
  assert.deepEqual(selected(["services/posts/index.js"]), ["posts", "services"]);
  assert.deepEqual(selected(["services/subreddits/package-lock.json"]), ["services", "subreddits"]);
  assert.deepEqual(selected(["services/scraper/serverless.yml"]), ["scraper", "scraper_verify", "services"]);
  assert.deepEqual(selected(["webui/deployment/deploy-to-s3.js", "services/posts/models/post.js"]), ["posts", "services", "webui"]);
});

test("infrastructure and shared feed changes fan out to their actual consumers", () => {
  assert.deepEqual(selected(["infrastructure/main.tf"]), full);
  assert.deepEqual(selected(["infrastructure/.terraform.lock.hcl"]), full);
  assert.deepEqual(selected(["services/posts/subreddits.json"]), consumers);
  assert.deepEqual(selected([".npmrc"]), consumers);
});

test("every external scraper Docker input selects the scraper and its verification", () => {
  for (const file of ["services/scraper/Dockerfile", "services/scraper/Dockerfile.dockerignore", "services/scraper/entrypoint.sh",
    "scripts/reddit-invisible/smoke.py", "scripts/reddit-invisible/check_session_runtime.py", "scripts/reddit-invisible/requirements.lock",
    "scripts/reddit-stagehand/browser-reader.js", "scripts/reddit-stagehand/f5-dom.js", "scripts/reddit-stagehand/f5-record.js", "scripts/reddit-stagehand/package.json"]) {
    assert.deepEqual(selected([file]), ["scraper", "scraper_verify", "services"], file);
  }
});

test("documentation and validation workflows do not deploy, while deployment logic fails safe", () => {
  assert.deepEqual(selected(["README.md", "AGENTS.md", "webui/README.md", "infrastructure/tests/cdn.tftest.hcl",
    "services/posts/index.test.js", "scripts/select-deployment.test.cjs", "scripts/reddit-invisible/test_smoke.py", ".github/workflows/pr-checks.yml", ".github/workflows/verify-browser-scraper.yml"]), []);
  assert.deepEqual(selected([".github/workflows/deploy.yml"]), full);
  assert.deepEqual(selected(["scripts/select-deployment.cjs"]), full);
  assert.deepEqual(selected([".github/actions/deploy-helper/action.yml"]), full);
  assert.deepEqual(selected(["unknown-runtime-input"]), full);
  assert.deepEqual(selected(["scripts/check-browser-deployment.cjs"]), ["scraper_verify", "services"]);
});

test("first pushes and unavailable comparison commits select a complete deployment", () => {
  const sha = "a".repeat(40);
  for (const before of [undefined, "0".repeat(40), "not-a-commit"]) {
    const calls = [];
    const result = selectFromEvent({ eventName: "push", event: { before }, sha, git: (args) => { calls.push(args); return ""; } });
    assert.ok(Object.values(result).every(Boolean));
    assert.deepEqual(calls, []);
  }
  assert.ok(Object.values(selectFromEvent({ eventName: "push", event: { before: "b".repeat(40) }, sha,
    git: () => { throw new Error("Commit not available"); } })).every(Boolean));
});

test("manual scope selects one component or a validated immutable successful baseline", () => {
  const sha = "a".repeat(40);
  const before = "b".repeat(40);
  const calls = [];
  const git = (args) => { calls.push(args); return args[0] === "diff" ? "webui/src/App.jsx\0" : ""; };
  assert.ok(Object.values(selectFromEvent({ eventName: "workflow_dispatch", sha, scope: "full", git })).every(Boolean));
  assert.deepEqual(calls, []);
  for (const scope of ["webui", "posts", "subreddits", "scraper"]) {
    const selection = selectFromEvent({ eventName: "workflow_dispatch", sha, scope, git });
    assert.equal(selection[scope], true);
    assert.equal(selection.infrastructure, false);
    assert.equal(selection.webui, scope === "webui");
  }
  assert.ok(Object.values(selectFromEvent({ eventName: "workflow_dispatch", sha, scope: "infrastructure", git })).every(Boolean));
  assert.deepEqual(calls, []);
  const result = selectFromEvent({ eventName: "workflow_dispatch", sha, scope: "changed", baseline: before, git });
  assert.equal(result.webui, true);
  assert.equal(result.services, false);
  assert.deepEqual(calls[0], ["cat-file", "-e", `${before}^{commit}`]);
  assert.deepEqual(calls.at(-1), ["diff", "--name-only", "--no-renames", "-z", before, sha, "--"]);
});

test("successful baseline lookup excludes manual and unrelated histories and validates GitHub filters", async () => {
  const target = "c".repeat(40);
  const newer = "d".repeat(40);
  const ancestor = "a".repeat(40);
  const run = (fields = {}) => ({ id: 1, event: "push", head_branch: "main", status: "completed", conclusion: "success", head_sha: ancestor, ...fields });
  const calls = [];
  const baseline = await findSuccessfulBaseline({ repository: "fairbanksio/f5news", token: "fixture-token", targetSha: target, currentRunId: "5",
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, "api.github.com");
      assert.equal(url.pathname, "/repos/fairbanksio/f5news/actions/workflows/deploy.yml/runs");
      assert.deepEqual(Object.fromEntries(url.searchParams), { branch: "main", event: "push", status: "success", per_page: "20", page: "1" });
      assert.equal(options.headers.Authorization, "Bearer fixture-token");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ workflow_runs: [run({ event: "workflow_dispatch" }), run({ head_branch: "develop" }),
        run({ conclusion: "failure" }), run({ id: 5 }), run({ head_sha: "invalid" }), run({ head_sha: newer }), run()] }) };
    }, git: (args) => { calls.push(args); if (args[0] === "merge-base" && args[2] === newer) throw new Error("Not an ancestor"); return ""; },
  });
  assert.equal(baseline, ancestor);
  assert.deepEqual(calls.at(-1), ["merge-base", "--is-ancestor", ancestor, target]);
});

test("baseline lookup is bounded and API failure or missing ancestry falls back to full deployment", async () => {
  let calls = 0;
  const config = { repository: "fairbanksio/f5news", token: "fixture-token", targetSha: "c".repeat(40), git: () => "" };
  assert.equal(await findSuccessfulBaseline({ ...config, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ workflow_runs: Array.from({ length: 20 }, () => ({})) }) }; } }), undefined);
  assert.equal(calls, 2);
  assert.equal(await findSuccessfulBaseline({ ...config, fetchImpl: async () => ({ ok: false }) }), undefined);
  assert.equal(await findSuccessfulBaseline({ ...config, fetchImpl: async () => { throw new Error("Private provider details"); } }), undefined);
  assert.ok(Object.values(selectFromEvent({ eventName: "push", event: { before: "b".repeat(40) }, sha: config.targetSha })).every(Boolean));
  assert.ok(Object.values(selectFromEvent({ eventName: "push", event: { before: "b".repeat(40) }, sha: config.targetSha, baseline: "a".repeat(40),
    git: () => { throw new Error("Not an ancestor"); } })).every(Boolean));
});

test("push selection uses the complete immutable range and accounts for deleted and renamed paths", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "f5-deployment-selection-"));
  const git = (args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, encoding: "utf8" });
  const commit = () => {
    git(["add", "-A"]);
    git(["-c", "user.name=Deployment Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--no-gpg-sign", "-qm", "Fixture"]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  try {
    git(["init", "-q", "-b", "feature/fixture"]);
    mkdirSync(path.join(directory, "webui"));
    mkdirSync(path.join(directory, "services/posts"), { recursive: true });
    writeFileSync(path.join(directory, "webui/old.js"), "initial");
    const before = commit();
    mkdirSync(path.join(directory, "services/scraper"));
    writeFileSync(path.join(directory, "services/scraper/index.js"), "Previously failed deployment");
    const previousPush = commit();
    renameSync(path.join(directory, "webui/old.js"), path.join(directory, "services/posts/moved.js"));
    const sha = commit();
    mkdirSync(path.join(directory, "infrastructure"));
    writeFileSync(path.join(directory, "infrastructure/later.tf"), "later");
    commit();
    const selection = selectFromEvent({ eventName: "push", event: { before: previousPush }, baseline: before, sha, git });
    assert.equal(selection.posts, true);
    assert.equal(selection.webui, true);
    assert.equal(selection.infrastructure, false);
    assert.equal(selection.scraper, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const workflow = yaml.load(readFileSync(path.join(__dirname, "../.github/workflows/deploy.yml"), "utf8"));
const condition = (job, needs, branch = "refs/heads/main", cancelled = false) => Function("github", "needs", "always", "cancelled", `return ${workflow.jobs[job].if}`)({ ref: branch }, needs, () => true, () => cancelled);
const needs = (paths, infrastructure = "skipped", services = "skipped") => ({ changes: { result: "success", outputs: Object.fromEntries(Object.entries(selectDeployment(paths)).map(([name, value]) => [name, String(value)])) }, infrastructure: { result: infrastructure }, services: { result: services } });

test("skipped prerequisites allow targeted deployments without bypassing failed or cancelled jobs", () => {
  assert.equal(condition("webapp", needs(["webui/src/App.jsx"])), true);
  assert.equal(condition("services", needs(["services/posts/index.js"])), true);
  assert.equal(condition("webapp", needs(["services/posts/index.js"])), false);
  for (const status of ["failure", "cancelled"]) {
    assert.equal(condition("services", needs(["infrastructure/main.tf"], status)), false);
    assert.equal(condition("webapp", needs(["infrastructure/main.tf"], "success", status)), false);
  }
  const invalidScope = needs(["webui/src/App.jsx"]);
  invalidScope.changes.result = "failure";
  assert.equal(condition("webapp", invalidScope), false);
  assert.equal(condition("webapp", needs(["webui/src/App.jsx"]), "refs/heads/develop"), false);
  assert.equal(condition("services", needs(["services/posts/index.js"]), "refs/heads/develop"), false);
  assert.equal(condition("services", needs(["services/posts/index.js"]), "refs/heads/main", true), false);
  assert.equal(condition("webapp", needs(["webui/src/App.jsx"]), "refs/heads/main", true), false);
});

test("service steps remain scoped and deployment authentication and read-only verification stay intact", () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.scope.default, "full");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.scope.options, ["full", "changed", "webui", "posts", "subreddits", "scraper", "infrastructure"]);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.equal(workflow.jobs.changes.permissions.actions, "read");
  const services = workflow.jobs.services;
  const deploys = services.steps.filter((step) => step.run === "npx serverless deploy");
  assert.equal(deploys.length, 3);
  for (const step of deploys) {
    const component = step["working-directory"].split("/").at(-1);
    assert.equal(step.if, `needs.changes.outputs.${component} == 'true'`);
    assert.equal(step.env.SERVERLESS_ACCESS_KEY, "${{ secrets.SERVERLESS_ACCESS_KEY }}");
  }
  const probe = services.steps.find((step) => step.run === "node scripts/check-browser-deployment.cjs");
  assert.equal(probe.if, "needs.changes.outputs.scraper_verify == 'true'");
  assert.equal(probe.env.F5_PROBE_DEPLOYMENT, "true");
  assert.equal(services.permissions["id-token"], "write");
  assert.equal(workflow.jobs.webapp.permissions["id-token"], "write");
  const webSteps = workflow.jobs.webapp.steps.map((step) => step.run).filter(Boolean);
  assert.deepEqual(webSteps, ["npm ci", "npm run generate-config", "npm run deploy"]);
  assert.equal(workflow.jobs.infrastructure.steps.find((step) => step.uses?.startsWith("hashicorp/setup-terraform@")).with.cli_config_credentials_token, "${{ secrets.TF_API_TOKEN }}");
});
