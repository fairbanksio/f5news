# Reddit Rising Prototype

Read exact metadata from Reddit's rendered pages with Stagehand 4.4.0 and save JSON locally. This tool makes no AI requests and needs no model API key or Browserbase credentials. MongoDB import and deployment are not implemented; the scheduled Lambda scraper is unchanged.

## Setup

Use Node 24.15 or newer within 24.x. In this directory:

```sh
npm ci
cp .env.example .env
```

The optional `.env` file sets `CHROME_CDP_URL` for attach mode.

## Chrome Connection

Use `--launch` to open installed macOS Chrome with a separate prototype profile and Stagehand's settings. The ignored `.chrome-profile/` directory preserves that profile between runs. The tool closes the Chrome instance it launches.

To attach to an existing browser, omit `--launch`. Set `CHROME_CDP_URL` to its loopback DevTools endpoint, normally `http://127.0.0.1:9222`, or a local `ws://` browser target. Attach mode closes only the extraction tab and disconnects, leaving Chrome and your other tabs running.

Stagehand needs a DevTools endpoint and support for discovering or loading its browser extension. An ordinary Chrome session or the Codex Chrome extension alone does not provide this connection. Stagehand may load its bundled extension into the attached browser. The tool does not restart or reconfigure an existing Chrome session.

Chrome 144 or newer supports enabling debugging in the running session at `chrome://inspect/#remote-debugging`. When HTTP discovery returns 404, the tool reads Chrome's macOS `DevToolsActivePort` file if its port matches `CHROME_CDP_URL`. See [Chrome's connection instructions](https://developer.chrome.com/docs/devtools/agents/get-started/configuration/).

If Stagehand reports `CDP websocket failed to open`, Chrome may be rejecting the extension's WebSocket Origin. Restarting Chrome with `--remote-allow-origins=chrome-extension://<stagehand-extension-id>` allows that specific origin. Find the ID at `chrome://extensions`. Repeated Allow clicks cannot fix an origin rejection. The tool does not change this setting.

## Run

```sh
npm start -- --launch --subreddit news
npm start -- --launch --subreddit technology --limit 25
npm test
```

The default is 25 posts, matching the existing Lambda's Reddit page size. Set `--limit` to choose 1–25 posts. The tool scrolls the Rising listing for up to 12 attempts, stopping after three attempts find no new posts or the limit is reached. It excludes promoted and pinned posts and deduplicates by Reddit ID. Only galleries open detail pages. Text and mixed-media discussions use listing metadata.

When Reddit shows a human check, complete it in Chrome within three minutes. The tool does not solve challenges. Access blocks and empty listings fail without replacing the previous output.

Progress logs include elapsed time and a heartbeat every ten seconds. Attach mode checks the HTTP DevTools endpoint with a three-second deadline. A heartbeat means an operation is waiting, not that it is making progress. Logs omit raw SDK errors.

## Output

Results default to the ignored `output/<subreddit>-rising.json`. Use `--output /absolute/path/results.json` to choose another location. Keep extracted data outside tracked files.

The JSON includes subreddit, sort, source URL, fetch time, and:

- `posts`: Mongo-shaped records with title, domain, destination URL, Reddit comment path, author, exact Unix creation time, numeric votes and comments, fetch time, and subreddit. Usable thumbnails are included when available.
- `redditListing.data.children`: API-shaped records for posts that pass the required checks. Incomplete records stay in `posts` for inspection.
- `completeness`: each Reddit ID, its `ready` flag, and `missingFields`. Optional gaps, such as a missing thumbnail, do not prevent readiness.
- `readyForImport`: whether every extracted record passes the required checks. This flag does not perform an import.

Media fields appear only when needed: images add `post_hint`, videos add `is_video` and DASH media, galleries add `is_gallery` and image metadata, and discussions add `is_self`. Gallery ordering and image preview data also appear in the API-shaped records where the existing image resolver needs them. Body text, vote ratios, legacy broadcast fields, false flags, and empty media fields are omitted.

Creation times and counts come from exact page attributes, never relative ages or rounded display text. Missing core values remain `null` and prevent readiness. Images require a full image URL, galleries require complete image entries, and videos require a DASH URL. When only Reddit HLS is available, the tool fetches the corresponding MPD and checks that it contains a DASH manifest before accepting it. Readiness checks the extracted payload; it does not verify a deployed app or database write.

## References

- [Stagehand Browser Configuration](https://docs.stagehand.dev/v4/configuration/browser)
- [Chrome Connection Instructions](https://developer.chrome.com/docs/devtools/agents/get-started/configuration/)
