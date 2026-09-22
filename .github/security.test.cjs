const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const yaml = require('../services/scraper/node_modules/js-yaml');
const root = path.join(__dirname, '..');
const readYaml = file => yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));

test('production jobs require main and preserve existing deployment authentication', () => {
  const workflow = readYaml('.github/workflows/deploy.yml');
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.if, "github.ref == 'refs/heads/main'");
    assert.equal(job.environment, undefined);
    assert.equal(job.env?.SERVERLESS_ACCESS_KEY, undefined);
    for (const step of job.steps) {
      if (step.env?.SERVERLESS_ACCESS_KEY) assert.equal(step.run, 'npx serverless deploy');
    }
  }
});

test('PR validation does not receive Terraform Cloud credentials', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/pr-checks.yml'), 'utf8');
  assert.ok(!source.includes('TF_API_TOKEN'));
  assert.ok(!source.includes('cli_config_credentials_token'));
});

test('Snyk fails without a token and scans lockfiles without installing PR dependencies', () => {
  const workflow = readYaml('.github/workflows/snyk.yml');
  const job = workflow.jobs['open-source'];
  assert.equal(job.env?.SNYK_TOKEN, undefined);
  const requireToken = job.steps.find(step => step.name === 'Require Snyk configuration');
  for (const [token, expected] of [['', 1], ['unit-test-placeholder', 0]]) {
    const run = spawnSync('sh', ['-c', requireToken.run], { env: { PATH: process.env.PATH, SNYK_TOKEN: token } });
    assert.equal(run.status, expected);
  }
  const scan = job.steps.find(step => step.name === 'Scan dependencies');
  assert.ok(scan.env.SNYK_TOKEN);
  assert.ok(scan.with.args.includes("--file=${{ matrix.project }}/package-lock.json"));
  assert.equal(scan.if, undefined);
  assert.ok(!job.steps.some(step => /npm (ci|install)/.test(step.run || '')));
  for (const project of job.strategy.matrix.project) {
    assert.ok(fs.existsSync(path.join(root, project, 'package-lock.json')));
  }
});

test('API allowlist matches the scraper schedule and static subreddit API', async () => {
  const configured = require('../services/posts/subreddits.json');
  const scheduled = readYaml('services/scraper/serverless.yml').functions.fetchPosts.events
    .filter(event => event.schedule).map(event => event.schedule.input.subreddit);
  const { get_subreddits } = require('../services/subreddits/index');
  const response = await get_subreddits({ headers: { origin: 'https://f5.news' } });
  assert.deepEqual(configured, scheduled);
  assert.deepEqual(configured, JSON.parse(response.body).data);
});

test('development services publish ports only on loopback and require credentials', () => {
  const compose = readYaml('resources/data-analysis/docker-compose.yml');
  for (const service of Object.values(compose.services)) {
    for (const port of service.ports || []) assert.ok(port.startsWith('127.0.0.1:'));
  }
  const minio = compose.services.minio.environment.join('\n');
  assert.ok(minio.includes('AWS_ACCESS_KEY_ID:?'));
  assert.ok(minio.includes('AWS_SECRET_ACCESS_KEY:?'));
});
