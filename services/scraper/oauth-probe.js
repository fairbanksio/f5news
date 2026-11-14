const { GetParametersCommand, SSMClient } = require("@aws-sdk/client-ssm");

const names = ["reddit_client_id", "reddit_secret_key"];
const userAgent = "linux:f5news-oauth-diagnostic:v1.0 (by /u/f5news)";
const requestOptions = { redirect: "error" };

async function probeRedditOAuth({ fetchImpl = globalThis.fetch, ssm = new SSMClient({ maxAttempts: 1 }) } = {}) {
  let stage = "credentials";
  try {
    const { Parameters = [] } = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: true }),
      { abortSignal: AbortSignal.timeout(5000) });
    const [id, secret] = names.map((name) => Parameters.find((parameter) => parameter.Name === name)?.Value);
    if (!id || !secret) return { stage, outcome: "missing" };

    stage = "token";
    const authorization = Buffer.from(id + ":" + secret).toString("base64");
    const token = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
      ...requestOptions, method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": userAgent, Authorization: "Basic " + authorization,
        "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const result = { stage, outcome: "rejected", tokenStatus: token.status };
    if (!token.ok) return result;
    const { access_token: accessToken } = await token.json();
    if (typeof accessToken !== "string" || !accessToken) return result;

    stage = "listing";
    const listing = await fetchImpl("https://oauth.reddit.com/r/politics/rising?limit=1", {
      ...requestOptions, signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": userAgent, Authorization: "Bearer " + accessToken },
    });
    const listingResult = { stage, outcome: "rejected", tokenStatus: token.status, listingStatus: listing.status };
    if (!listing.ok) return listingResult;
    const payload = await listing.json();
    if (payload?.kind !== "Listing" || !Array.isArray(payload.data?.children)) return listingResult;
    return { ...listingResult, outcome: "success", postCount: payload.data.children.length };
  } catch {
    return { stage, outcome: "request_failed" };
  }
}

module.exports = { probeRedditOAuth };
