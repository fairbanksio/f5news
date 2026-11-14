const assert = require("node:assert/strict");
const { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } = require("node:crypto");
const { access, writeFile } = require("node:fs/promises");
const { dirname } = require("node:path");
const test = require("node:test");
const { captureChallenge } = require("./challenge-capture");

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const captureKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");

test("encrypts the screenshot and removes the temporary file even when the scrape stops", async () => {
  const image = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  let temporaryFile;
  const result = await captureChallenge(captureKey, async (file) => {
    temporaryFile = file;
    await writeFile(file, image, { mode: 0o600 });
    throw new Error("challenge");
  });
  assert.equal(result.outcome, "captured");
  const { wrappedKey, iv, tag, ciphertext, contentType } = result.screenshot;
  assert.equal(contentType, "image/jpeg");
  const secret = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(wrappedKey, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  assert.deepEqual(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]), image);
  await assert.rejects(access(dirname(temporaryFile)), { code: "ENOENT" });
});

test("rejects invalid keys before scraping and reports cooldown without an image", async () => {
  await assert.rejects(captureChallenge("not-a-key", () => assert.fail("Scraper invoked with an invalid key")));
  const result = await captureChallenge(captureKey, async () => {
    throw Object.assign(new Error("backoff"), { readBackoffSeconds: 42 });
  });
  assert.deepEqual(result, { outcome: "cooldown" });
});
