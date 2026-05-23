const assert = require("assert");
const { Readable } = require("stream");
const test = require("node:test");

const {
  extractMetaImage,
  fetchArticleImage,
  makeSafeLookup,
  imageSource,
  isSafeHttpUrl,
  selectPublicAddress,
} = require("./imageSource");

test("extractMetaImage prefers og:image and resolves relative URLs", () => {
  const html = `
    <html>
      <head>
        <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
        <meta property="og:image" content="/images/story.jpg">
      </head>
    </html>
  `;

  assert.equal(
    extractMetaImage(html, "https://www.example.com/news/story"),
    "https://www.example.com/images/story.jpg"
  );
});

test("fetchArticleImage rejects private network URLs before fetching", async () => {
  let fetchCalled = false;

  const image = await fetchArticleImage("http://127.0.0.1/article", {
    fetchImpl: async () => {
      fetchCalled = true;
    },
  });

  assert.equal(image, "");
  assert.equal(fetchCalled, false);
});

test("fetchArticleImage extracts twitter image from fetched article HTML", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => {
          if (name.toLowerCase() === "content-type") {
            return "text/html; charset=utf-8";
          }
          return null;
        },
      },
      text: async () =>
        '<meta name="twitter:image" content="https://publisher.example/image.jpg">',
    }),
  });

  assert.equal(image, "https://publisher.example/image.jpg");
});

test("fetchArticleImage extracts early metadata from oversized article HTML", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    maxBytes: 128,
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => {
          if (name.toLowerCase() === "content-type") {
            return "text/html; charset=utf-8";
          }
          if (name.toLowerCase() === "content-length") {
            return "999999";
          }
          return null;
        },
      },
      body: Readable.from([
        '<meta property="og:image" content="https://publisher.example/large-page.jpg">',
        "x".repeat(999999),
      ]),
    }),
  });

  assert.equal(image, "https://publisher.example/large-page.jpg");
});

test("imageSource uses Reddit thumbnail before article metadata fallback", async () => {
  const image = await imageSource(
    {
      thumbnail: "https://b.thumbs.redditmedia.com/story.jpg",
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("article metadata should not be fetched");
      },
    }
  );

  assert.equal(image, "https://b.thumbs.redditmedia.com/story.jpg");
});

test("imageSource fetches article metadata when Reddit image fields are empty", async () => {
  const image = await imageSource(
    {
      thumbnail: "",
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => "https://publisher.example/og.jpg",
    }
  );

  assert.equal(image, "https://publisher.example/og.jpg");
});

test("isSafeHttpUrl rejects unsupported schemes", async () => {
  assert.equal(await isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(
    await isSafeHttpUrl("https://example.com/story", {
      resolveHostname: async () => [{ address: "93.184.216.34" }],
    }),
    true
  );
});

test("selectPublicAddress prefers public IPv4 when DNS returns IPv6 first", () => {
  assert.deepEqual(
    selectPublicAddress([
      { address: "2a04:4e42:600::367", family: 6 },
      { address: "151.101.193.111", family: 4 },
    ]),
    { address: "151.101.193.111", family: 4 }
  );
});

test("makeSafeLookup returns an address array when agent requests all addresses", async () => {
  const lookup = makeSafeLookup(async () => [
    { address: "2a04:4e42:600::367", family: 6 },
    { address: "151.101.193.111", family: 4 },
  ]);

  const result = await new Promise((resolve, reject) => {
    lookup("example.com", { all: true }, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(addresses);
    });
  });

  assert.deepEqual(result, [{ address: "151.101.193.111", family: 4 }]);
});

test("fetchArticleImage returns empty when fetch does not settle before timeout", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });

  assert.equal(image, "");
});
