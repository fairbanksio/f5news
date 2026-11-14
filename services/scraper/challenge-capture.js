const { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } = require("node:crypto");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function readCaptureKey(value) {
  if (typeof value !== "string" || value.length > 1200 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Invalid screenshot public key");
  }
  const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "rsa" || ![2048, 3072, 4096].includes(key.asymmetricKeyDetails.modulusLength)) {
    throw new Error("Invalid screenshot public key");
  }
  return key;
}

function sealScreenshot(bytes, key) {
  const secret = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { version: 1, contentType: "image/jpeg", iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
      wrappedKey: publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, secret).toString("base64") };
  } finally {
    secret.fill(0);
  }
}

async function captureChallenge(publicKey, scrape) {
  const key = readCaptureKey(publicKey);
  const directory = await mkdtemp(join(tmpdir(), "f5-challenge-"));
  const screenshotPath = join(directory, "challenge.jpg");
  try {
    let outcome = "not_seen";
    try {
      await scrape(screenshotPath);
    } catch (error) {
      outcome = Number.isInteger(error?.readBackoffSeconds) ? "cooldown" :
        error?.sessionReason === "feed_challenge" ? "challenge" : "scrape_failed";
    }
    const bytes = await readFile(screenshotPath).catch(() => null);
    if (!bytes || bytes.length < 4 || bytes.length > 256 * 1024 ||
      bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return { outcome };
    try {
      return { outcome: "captured", screenshot: sealScreenshot(bytes, key) };
    } finally {
      bytes.fill(0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

module.exports = { captureChallenge };
