const assert = require("assert");
const test = require("node:test");

const {
  createCorsHeaders,
  getAllowedOrigins,
  isAllowedOrigin,
} = require("./cors");

const originalPrimaryDomainName = process.env.PRIMARY_DOMAIN_NAME;
const originalOffline = process.env.IS_OFFLINE;
const originalLocalOrigin = process.env.LOCAL_FRONTEND_ORIGIN;
const originalLambdaName = process.env.AWS_EXECUTION_ENV;

test.beforeEach(() => {
  delete process.env.IS_OFFLINE;
  delete process.env.LOCAL_FRONTEND_ORIGIN;
  delete process.env.AWS_EXECUTION_ENV;
});

test.afterEach(() => {
  for (const [key, value] of [["LOCAL_FRONTEND_ORIGIN", originalLocalOrigin], ["IS_OFFLINE", originalOffline], ["AWS_EXECUTION_ENV", originalLambdaName]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalPrimaryDomainName === undefined) {
    delete process.env.PRIMARY_DOMAIN_NAME;
    return;
  }

  process.env.PRIMARY_DOMAIN_NAME = originalPrimaryDomainName;
});

test("allows the default production domain origins", () => {
  delete process.env.PRIMARY_DOMAIN_NAME;

  assert.deepEqual([...getAllowedOrigins()], [
    "https://f5.news",
    "https://www.f5.news",
  ]);
  assert.equal(isAllowedOrigin("https://f5.news"), true);
  assert.equal(createCorsHeaders("https://www.f5.news")["Access-Control-Allow-Origin"], "https://www.f5.news");
});

test("allows origins derived from the configured primary domain", () => {
  process.env.PRIMARY_DOMAIN_NAME = "staging.f5.test";

  assert.deepEqual([...getAllowedOrigins()], [
    "https://staging.f5.test",
    "https://www.staging.f5.test",
  ]);
  assert.equal(isAllowedOrigin("https://staging.f5.test"), true);
  assert.equal(isAllowedOrigin("https://f5.news"), false);
});


test("local HTTP origins require offline mode and stay blocked in Lambda", () => {
  const origins = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"];
  for (const origin of origins) assert.equal(isAllowedOrigin(origin), false);
  process.env.IS_OFFLINE = "true";
  for (const origin of origins) {
    assert.equal(isAllowedOrigin(origin), true);
    assert.equal(createCorsHeaders(origin)["Access-Control-Allow-Origin"], origin);
  }
  for (const origin of ["http://localhost.evil.example:3000", "http://192.168.1.2:3000", "http://localhost:9999", "null"]) {
    assert.equal(isAllowedOrigin(origin), false);
  }
  process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs24.x";
  for (const origin of origins) {
    assert.equal(isAllowedOrigin(origin), false);
    assert.deepEqual(createCorsHeaders(origin), {});
  }
});


test("custom local ports require an explicit HTTP loopback origin and offline mode", () => {
  process.env.LOCAL_FRONTEND_ORIGIN = "http://localhost:3001";
  assert.equal(isAllowedOrigin("http://localhost:3001"), false);
  process.env.IS_OFFLINE = "true";
  assert.equal(isAllowedOrigin("http://localhost:3001"), true);
  for (const value of ["https://localhost:3001", "http://evil.example:3001", "http://user:pass@localhost:3001", "http://localhost:3001/path", "not a URL"]) {
    process.env.LOCAL_FRONTEND_ORIGIN = value;
    assert.equal(isAllowedOrigin("http://localhost:3001"), false);
    assert.equal(isAllowedOrigin(value), false);
  }
  process.env.LOCAL_FRONTEND_ORIGIN = "http://localhost:3001";
  process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs24.x";
  assert.equal(isAllowedOrigin("http://localhost:3001"), false);
});


test("offline Lambda metadata does not disable local origins", (t) => {
  const previous = process.env.AWS_LAMBDA_FUNCTION_NAME;
  t.after(() => {
    if (previous === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = previous;
  });
  process.env.IS_OFFLINE = "true";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "posts-dev-getPostsBySubreddit";
  assert.equal(isAllowedOrigin("http://localhost:3000"), true);
});
