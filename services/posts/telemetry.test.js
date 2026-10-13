const assert = require("assert");
const test = require("node:test");
const { errorFields } = require("./telemetry");

test("redacts configured credentials and URLs from messages and stacks", () => {
  const previous = process.env.MONGO_CONNECTION_STRING;
  process.env.MONGO_CONNECTION_STRING = "private-connection-marker";
  try {
    const error = new Error("private-connection-marker https://example.com/path?token=private-url-marker");
    const fields = errorFields(error);
    assert.equal(fields.errorMessage, "[redacted] [redacted-url]");
    assert.ok(!JSON.stringify(fields).includes("private-connection-marker"));
    assert.ok(!JSON.stringify(fields).includes("private-url-marker"));
    assert.match(fields.stack, /telemetry.test.js/);
  } finally {
    if (previous === undefined) delete process.env.MONGO_CONNECTION_STRING;
    else process.env.MONGO_CONNECTION_STRING = previous;
  }
});

test("bounds diagnostic size and handles non-Error failures", () => {
  const error = new Error("x".repeat(10000));
  const fields = errorFields(error);
  assert.equal(fields.errorMessage.length, 512);
  assert.equal(fields.stack.length, 4096);
  assert.equal(errorFields("dependency unavailable").errorMessage, "dependency unavailable");
  assert.equal(errorFields(null).errorType, "Error");
});
