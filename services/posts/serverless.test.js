const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
const Settings = require('serverless-api-gateway-throttling/src/ApiGatewayThrottlingSettings');
const { updateRestApi } = require('serverless-api-gateway-throttling/src/updateRestApiStageThrottling');

test('deployment config bounds Lambda concurrency and sets gateway throttles', async () => {
  const service = yaml.load(fs.readFileSync(path.join(__dirname, 'serverless.yml'), 'utf8'));
  assert.ok(service.plugins.includes('serverless-api-gateway-throttling'));
  for (const fn of Object.values(service.functions)) assert.equal(fn.reservedConcurrency, 5);
  const calls = [];
  service.provider.apiGateway = { restApiId: 'test-api' };
  service.getFunction = name => service.functions[name];
  const serverless = {
    service,
    cli: { log() {} },
    providers: { aws: { request: async (...args) => { calls.push(args); } } },
  };
  const settings = new Settings(serverless, { stage: 'test' });
  await updateRestApi(settings, serverless);
  assert.equal(calls.length, 1);
  const [api, method, request] = calls[0];
  assert.equal(api, 'APIGateway');
  assert.equal(method, 'updateStage');
  assert.equal(request.restApiId, 'test-api');
  assert.equal(request.stageName, 'test');
  assert.ok(request.patchOperations.length >= 4);
  for (const operation of request.patchOperations) {
    assert.equal(operation.op, 'replace');
    assert.equal(operation.value, operation.path.endsWith('rateLimit') ? '20' : '10');
  }
});
