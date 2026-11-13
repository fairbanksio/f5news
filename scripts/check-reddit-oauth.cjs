const { execFileSync } = require("node:child_process");
const { createRedditOAuthSource } = require("../services/scraper/reddit-oauth-source");

const parameters = {
  REDDIT_CLIENT_ID: "/reddit_client_id",
  REDDIT_SECRET_KEY: "/reddit_secret_key",
  REDDIT_USERNAME: "/reddit_username",
  REDDIT_PASSWORD: "/reddit_password",
};

async function main() {
  const env = {};
  try {
    for (const [key, name] of Object.entries(parameters)) {
      env[key] = execFileSync("aws", ["ssm", "get-parameter", "--name", name, "--with-decryption",
        "--query", "Parameter.Value", "--output", "text"], {
        encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (!env[key] || env[key] === "None") throw new Error("Missing parameter");
    }
  } catch {
    console.error("Unable to read the registered Reddit app credentials from SSM.");
    process.exitCode = 1;
    return;
  }
  try {
    const source = createRedditOAuthSource({ env });
    const result = await source({ subreddits: ["politics"], limit: 1, timeoutMs: 12000 });
    const count = result.feeds[0]?.children.length ?? 0;
    if (count !== 1) throw new Error("No usable posts");
    console.log(JSON.stringify({ subreddit: "politics", count }));
  } catch (error) {
    const status = Number.isInteger(error.httpStatus) ? error.httpStatus : undefined;
    console.error(JSON.stringify({ message: "Reddit OAuth probe did not return a usable Rising post", status }));
    process.exitCode = 1;
  }
}

main();
