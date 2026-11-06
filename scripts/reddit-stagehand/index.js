import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readListing, readRenderedPosts, resolveVideoManifest } from "./f5-dom.js";
import { toF5Record } from "./f5-record.js";

class PrototypeError extends Error {}

export function readOptions(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      subreddit: { type: "string", default: "news" },
      limit: { type: "string", default: "25" },
      output: { type: "string" },
      launch: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { help: true };
  if (!/^[a-zA-Z0-9_]{2,21}$/.test(values.subreddit)) {
    throw new PrototypeError("Use one subreddit name, such as news or technology.");
  }
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new PrototypeError("Limit must be an integer from 1 to 25.");
  }
  const cdpUrl = env.CHROME_CDP_URL || "http://127.0.0.1:9222";
  const endpoint = new URL(cdpUrl);
  if (!["http:", "ws:"].includes(endpoint.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password) {
    throw new PrototypeError("CHROME_CDP_URL must point to a local Chrome DevTools endpoint.");
  }
  return {
    subreddit: values.subreddit,
    limit,
    output: resolve(values.output || `output/${values.subreddit.toLowerCase()}-rising.json`),
    cdpUrl,
    launch: values.launch,
  };
}

export function createProgress({ write = (line) => console.error(line), now = Date.now, heartbeatMs = 10_000 } = {}) {
  const started = now();
  const log = (message) => write(`[${((now() - started) / 1000).toFixed(1)}s] ${message}`);
  return {
    log,
    async step(label, operation) {
      const stepStarted = now();
      log(`${label}...`);
      const heartbeat = setInterval(() => {
        log(`Still waiting: ${label.toLowerCase()} (${Math.round((now() - stepStarted) / 1000)}s in this step).`);
      }, heartbeatMs);
      heartbeat.unref?.();
      try {
        const result = await operation();
        log(`${label}: done (${((now() - stepStarted) / 1000).toFixed(1)}s).`);
        return result;
      } catch (error) {
        log(`${label}: failed.`);
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}

export async function checkChrome(cdpUrl, fetchImpl = fetch, readFileImpl = readFile) {
  const endpoint = new URL(cdpUrl);
  // A WebSocket URL already identifies the browser target; let Stagehand connect directly.
  if (endpoint.protocol === "ws:") return cdpUrl;
  try {
    const response = await fetchImpl(new URL("/json/version", endpoint), { signal: AbortSignal.timeout(3_000) });
    // Chrome's in-session debugging mode omits HTTP discovery. Its browser target is in this file.
    if (response.status === 404 && ["localhost", "127.0.0.1"].includes(endpoint.hostname)) {
      const activePort = await readFileImpl(resolve(homedir(), "Library/Application Support/Google/Chrome/DevToolsActivePort"), "utf8");
      const [port, target] = activePort.trim().split(/\r?\n/);
      if (port !== endpoint.port || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(target)) {
        throw new Error("Chrome endpoint does not match the active browser");
      }
      return `ws://127.0.0.1:${port}${target}`;
    }
    const version = await response.json();
    if (!response.ok || !version.webSocketDebuggerUrl) throw new Error("Invalid DevTools response");
    return cdpUrl;
  } catch {
    throw new PrototypeError(`Chrome DevTools is unavailable at ${endpoint.origin}. Chrome must expose a debugging endpoint before Stagehand can attach. Setting CHROME_CDP_URL alone does not enable it.`);
  }
}

export async function waitForReddit(page, progress, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 180_000 } = {}) {
  const started = now();
  let notified = false;
  while (true) {
    const state = await page.evaluate(() => {
      const text = `${document.title}\n${document.body?.innerText || ""}`;
      if (/prove your humanity|verify (that )?you('re| are) human|complete the challenge/i.test(text)) return "challenge";
      if (/blocked by network security|you.have been blocked/i.test(text)) return "blocked";
      if (document.readyState !== "complete" || !document.title || !document.body?.innerText.trim()) return "loading";
      return "ready";
    });
    if (state === "ready") return;
    if (state === "blocked") throw new PrototypeError("Reddit blocked this browser. No results were saved.");
    if (state === "challenge" && !notified) {
      progress.log("Reddit requires a human check. Complete it in the prototype Chrome window. Waiting up to three minutes before reading metadata.");
      notified = true;
    }
    if (now() - started >= timeoutMs) {
      throw new PrototypeError(state === "challenge"
        ? "Reddit's human check is still present. Run again and complete it in the prototype Chrome window. No results were saved."
        : "Reddit's page did not finish loading. No results were saved.");
    }
    await sleep(2_000);
  }
}

export async function extractRising(options, { localBrowser, Stagehand }, progress = createProgress()) {
  const browser = options.launch
    ? await progress.step("Launching prototype Chrome", () => localBrowser.launch({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: resolve(".chrome-profile"),
      preserveUserDataDir: true,
      headless: false,
    }))
    : await progress.step("Connecting to Chrome", () => localBrowser.connect({ cdpUrl: options.cdpUrl }));
  let page;
  try {
    await progress.step("Initializing Stagehand", () => Stagehand.create({
      browser,
      cache: false,
      logging: { level: "off" },
    }));
    page = await progress.step("Opening extraction tab", () => browser.context.newPage());
    const sourceUrl = `https://www.reddit.com/r/${options.subreddit}/rising/`;
    const response = await progress.step("Loading Reddit Rising", () => page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }));
    if (response && !response.ok()) throw new PrototypeError(`Reddit returned HTTP ${response.status()}.`);
    await progress.step("Checking Reddit access", () => waitForReddit(page, progress));
    const rawPosts = await progress.step("Reading exact listing metadata", () => readListing(page, options.subreddit, options.limit, progress));
    if (!rawPosts.length) throw new PrototypeError("No organic Rising posts found in Reddit's rendered listing.");
    const records = [];
    const fetchedAt = new Date();
    for (let index = 0; index < rawPosts.length; index += 1) {
      let raw = rawPosts[index];
      const type = raw.attributes["post-type"];
      if (type === "gallery") {
        const permalink = raw.attributes.permalink;
        const parsed = new URL(permalink, "https://www.reddit.com");
        const expectedId = raw.attributes.id?.slice(3);
        if (parsed.hostname !== "www.reddit.com" ||
            !parsed.pathname.toLowerCase().startsWith(`/r/${options.subreddit.toLowerCase()}/comments/${expectedId}/`)) {
          throw new PrototypeError("Post detail link does not match the requested listing.");
        }
        await progress.step(`Loading post detail ${index + 1}/${rawPosts.length}`, async () => {
          await page.goto(parsed.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await waitForReddit(page, progress);
          const details = await page.evaluate(readRenderedPosts, { detail: true });
          const detail = details.find((candidate) => candidate.attributes.id === raw.attributes.id);
          if (detail) raw = { ...raw, ...detail };
        });
      }
      if (raw.video) raw.video = await progress.step(`Checking video manifest ${index + 1}/${rawPosts.length}`, () => resolveVideoManifest(raw.video));
      records.push(toF5Record(raw, options.subreddit, { fetchedAt }));
    }
    const importable = records.filter((record) => record.ready);
    progress.log(`Read ${records.length} posts: ${importable.length} ready for F5, ${records.length - importable.length} incomplete.`);
    for (const record of records.filter((record) => !record.ready)) {
      progress.log(`Incomplete post ${record.reddit.data.id || "unknown"}: ${record.missingFields.join(", ")}.`);
    }
    return {
      subreddit: options.subreddit,
      sort: "rising",
      sourceUrl,
      fetchedAt: fetchedAt.toISOString(),
      posts: records.map((record) => record.post),
      redditListing: { data: { children: importable.map((record) => record.reddit) } },
      completeness: records.map((record) => ({ id: record.reddit.data.id, ready: record.ready, missingFields: record.missingFields })),
      readyForImport: importable.length === records.length,
    };
  } finally {
    // Only close Chrome when this run launched it.
    try {
      if (page) await progress.step("Closing extraction tab", () => page.close());
    } finally {
      if (options.launch) await progress.step("Closing prototype Chrome", () => browser.close());
      else await progress.step("Disconnecting from Chrome", () => browser.disconnect());
    }
  }
}

export function failureMessage(error) {
  if (error instanceof PrototypeError) return error.message;
  const detail = String(error?.message || "");
  if (/CDP websocket failed to open|CDP websocket closed before opening/i.test(detail)) {
    return "Stagehand's extension could not connect back to Chrome. The extension's WebSocket origin may be blocked. Chrome must be restarted with that extension origin allowed; repeating Allow will not fix an origin rejection.";
  }
  if (/ECONNREFUSED|fetch failed|connect.*timeout/i.test(detail)) {
    return "Cannot connect to Chrome. Check CHROME_CDP_URL and the existing browser's DevTools endpoint.";
  }
  if (/extension|Extensions\./i.test(detail)) {
    return "Chrome cannot load or find the Stagehand extension. Check extension support in the attached browser.";
  }
  if (/timeout|timed out/i.test(detail)) return "Browser operation timed out. Check the last progress step and Reddit in Chrome.";
  return "Extraction failed. Check Chrome, the Stagehand extension, and Reddit access.";
}

async function main() {
  const options = readOptions();
  if (options.help) {
    console.log("Extract Reddit Rising Posts\n\nnpm start -- --launch --subreddit news [--limit 25] [--output output/news-rising.json]\n\nOmit --launch to attach using CHROME_CDP_URL. No model API key is needed for exact metadata extraction.");
    return;
  }
  const progress = createProgress();
  progress.log(`Starting r/${options.subreddit} Rising extraction (limit ${options.limit}, exact browser metadata).`);
  if (!options.launch) options.cdpUrl = await progress.step("Checking Chrome DevTools", () => checkChrome(options.cdpUrl));
  const sdk = await progress.step("Loading Stagehand SDK", () => import("@browserbasehq/stagehand"));
  const result = await extractRising(options, sdk, progress);
  await progress.step("Saving results", async () => {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  });
  console.log(`Saved ${result.posts.length} posts to ${options.output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(failureMessage(error));
    process.exitCode = 1;
  });
}
