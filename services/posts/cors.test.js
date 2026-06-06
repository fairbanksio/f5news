const assert = require("assert");
const test = require("node:test");

const {
  createCorsHeaders,
  getAllowedOrigins,
  isAllowedOrigin,
} = require("./cors");

const originalPrimaryDomainName = process.env.PRIMARY_DOMAIN_NAME;

test.afterEach(() => {
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
