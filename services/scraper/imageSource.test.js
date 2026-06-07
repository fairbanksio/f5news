const assert = require("assert");
const { Readable } = require("stream");
const test = require("node:test");

const {
  extractMetaImage,
  fetchArticleImage,
  makeSafeLookup,
  imageSource,
  isSafeHttpUrl,
  mapWithConcurrency,
  selectPublicAddress,
} = require("./imageSource");

const createHeaders = (values = {}) => ({
  get: (name) => values[name.toLowerCase()] || null,
});

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

test("extractMetaImage decodes HTML entities in image URLs", () => {
  const html = `
    <meta property="og:image" content="https://cdn.example.com/story.jpg?x=1&amp;y=2&#x2f;3&#47;4&unknown;">
  `;

  assert.equal(
    extractMetaImage(html, "https://www.example.com/story"),
    "https://cdn.example.com/story.jpg?x=1&y=2/3/4&unknown;"
  );
});

test("extractMetaImage ignores unusable image URLs", () => {
  assert.equal(
    extractMetaImage(
      '<meta property="og:image" content="data:image/png;base64,abc">',
      "https://www.example.com/story"
    ),
    ""
  );
  assert.equal(
    extractMetaImage(
      '<meta property="og:image" content="http://[::1">',
      "https://www.example.com/story"
    ),
    ""
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

test("isSafeHttpUrl rejects malformed, localhost, private IPv6, and DNS failures", async () => {
  assert.equal(await isSafeHttpUrl("not a url"), false);
  assert.equal(await isSafeHttpUrl("https://localhost/story"), false);
  assert.equal(await isSafeHttpUrl("https://example.localhost/story"), false);
  assert.equal(await isSafeHttpUrl("http://[::1]/story"), false);
  assert.equal(await isSafeHttpUrl("http://[fe80::1]/story"), false);
  assert.equal(
    await isSafeHttpUrl("https://publisher.example/story", {
      resolveHostname: async () => {
        throw new Error("dns failed");
      },
    }),
    false
  );
});

test("isSafeHttpUrl rejects private DNS results", async () => {
  assert.equal(
    await isSafeHttpUrl("https://publisher.example/story", {
      resolveHostname: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    }),
    false
  );
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

test("fetchArticleImage accepts node-fetch default export module shape", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: {
      default: async () => ({
        ok: true,
        status: 200,
        headers: createHeaders({
          "content-type": "text/html; charset=utf-8",
        }),
        text: async () =>
          '<meta property="og:image" content="https://publisher.example/default-export.jpg">',
      }),
    },
  });

  assert.equal(image, "https://publisher.example/default-export.jpg");
});

test("fetchArticleImage uses a short default metadata timeout", async () => {
  let requestTimeout;

  await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async (url, options) => {
      requestTimeout = options.timeout;
      return {
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
          '<meta property="og:image" content="https://publisher.example/image.jpg">',
      };
    },
  });

  assert.equal(requestTimeout, 3000);
});

test("fetchArticleImage sends browser-like navigation headers", async () => {
  let requestHeaders;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34" }],
    fetchImpl: async (url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        headers: createHeaders({
          "content-type": "text/html; charset=utf-8",
        }),
        text: async () =>
          '<meta property="og:image" content="https://publisher.example/image.jpg">',
      };
    },
  });

  assert.equal(image, "https://publisher.example/image.jpg");
  assert.equal(requestHeaders["Accept-Language"], "en-US,en;q=0.9");
  assert.equal(requestHeaders["Upgrade-Insecure-Requests"], "1");
  assert.match(requestHeaders["User-Agent"], /Chrome\/\d+/);
  assert.match(requestHeaders.Accept, /application\/xml;q=0\.9/);
});

test("fetchArticleImage retries transient publisher denials once", async () => {
  let requestCount = 0;
  let deniedBodyDestroyed = false;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return {
          ok: false,
          status: 403,
          headers: createHeaders(),
          body: {
            destroy: () => {
              deniedBodyDestroyed = true;
            },
          },
        };
      }

      return {
        ok: true,
        status: 200,
        headers: createHeaders({
          "content-type": "text/html; charset=utf-8",
        }),
        text: async () =>
          '<meta property="og:image" content="https://publisher.example/image.jpg">',
      };
    },
  });

  assert.equal(image, "https://publisher.example/image.jpg");
  assert.equal(requestCount, 2);
  assert.equal(deniedBodyDestroyed, true);
});

test("fetchArticleImage retries transient fetch failures once", async () => {
  let requestCount = 0;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        throw new Error("socket hang up");
      }

      return {
        ok: true,
        status: 200,
        headers: createHeaders({
          "content-type": "text/html; charset=utf-8",
        }),
        text: async () =>
          '<meta property="og:image" content="https://publisher.example/image.jpg">',
      };
    },
  });

  assert.equal(image, "https://publisher.example/image.jpg");
  assert.equal(requestCount, 2);
});

test("fetchArticleImage retries metadata request timeouts once", async () => {
  let requestCount = 0;

  const image = await fetchArticleImage("https://publisher.example/story", {
    timeoutMs: 5,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return new Promise(() => {});
      }

      return {
        ok: true,
        status: 200,
        headers: createHeaders({
          "content-type": "text/html; charset=utf-8",
        }),
        text: async () =>
          '<meta property="og:image" content="https://publisher.example/image.jpg">',
      };
    },
  });

  assert.equal(image, "https://publisher.example/image.jpg");
  assert.equal(requestCount, 2);
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

test("fetchArticleImage returns empty when response body stream errors", async () => {
  const body = new Readable({
    read() {
      this.destroy(new Error("stream failed"));
    },
  });

  const image = await fetchArticleImage("https://publisher.example/story", {
    timeoutMs: 5,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        "content-type": "text/html; charset=utf-8",
      }),
      body,
    }),
  });

  assert.equal(image, "");
});

test("fetchArticleImage returns empty when article HTML is empty", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        "content-type": "text/html; charset=utf-8",
      }),
      text: async () => "",
    }),
  });

  assert.equal(image, "");
});

test("fetchArticleImage returns empty when fetch rejects", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      throw new Error("publisher connection failed");
    },
  });

  assert.equal(image, "");
});

test("fetchArticleImage destroys redirect response body before following location", async () => {
  let redirectBodyDestroyed = false;
  let requestCount = 0;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return {
          ok: false,
          status: 302,
          headers: {
            get: (name) => {
              if (name.toLowerCase() === "location") {
                return "/redirected-story";
              }
              return null;
            },
          },
          body: {
            destroy: () => {
              redirectBodyDestroyed = true;
            },
          },
        };
      }

      return {
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
          '<meta property="og:image" content="https://publisher.example/redirected.jpg">',
      };
    },
  });

  assert.equal(image, "https://publisher.example/redirected.jpg");
  assert.equal(redirectBodyDestroyed, true);
});

test("fetchArticleImage destroys redirect response body when location is missing", async () => {
  let bodyDestroyed = false;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      headers: createHeaders(),
      body: {
        destroy: () => {
          bodyDestroyed = true;
        },
      },
    }),
  });

  assert.equal(image, "");
  assert.equal(bodyDestroyed, true);
});

test("fetchArticleImage destroys non-OK response body", async () => {
  let bodyDestroyed = false;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      headers: createHeaders(),
      body: {
        destroy: () => {
          bodyDestroyed = true;
        },
      },
    }),
  });

  assert.equal(image, "");
  assert.equal(bodyDestroyed, true);
});

test("fetchArticleImage cancels non-HTML web response body", async () => {
  let bodyCanceled = false;

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        "content-type": "application/json",
      }),
      body: {
        cancel: () => {
          bodyCanceled = true;
        },
      },
    }),
  });

  assert.equal(image, "");
  assert.equal(bodyCanceled, true);
});

test("fetchArticleImage tolerates early-return responses without bodies", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: createHeaders(),
    }),
  });

  assert.equal(image, "");
});

test("imageSource uses Reddit preview image before low-resolution thumbnail", async () => {
  const image = await imageSource(
    {
      thumbnail:
        "https://external-preview.redd.it/story.jpeg?width=140&height=93&auto=webp",
      preview: {
        images: [
          {
            source: {
              url: "https://external-preview.redd.it/story.jpeg?auto=webp&amp;s=fullsize",
            },
          },
        ],
      },
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("article metadata should not be fetched");
      },
    }
  );

  assert.equal(
    image,
    "https://external-preview.redd.it/story.jpeg?auto=webp&s=fullsize"
  );
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

test("imageSource uses Reddit preview image when thumbnail is not usable", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
      preview: {
        images: [
          {
            source: {
              url: "https://preview.redd.it/story.jpg?width=640&amp;format=pjpg",
            },
          },
        ],
      },
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("article metadata should not be fetched");
      },
    }
  );

  assert.equal(
    image,
    "https://preview.redd.it/story.jpg?width=640&format=pjpg"
  );
});

test("imageSource uses Reddit gallery image when present", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
      is_gallery: true,
      gallery_data: {
        items: [{ media_id: "abc" }],
      },
      media_metadata: {
        abc: {
          s: {
            u: "https://preview.redd.it/gallery.jpg?width=640&amp;format=pjpg",
          },
        },
      },
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("article metadata should not be fetched");
      },
    }
  );

  assert.equal(
    image,
    "https://preview.redd.it/gallery.jpg?width=640&format=pjpg"
  );
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

test("imageSource falls back when article metadata fetch rejects", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("publisher blocked metadata request");
      },
    }
  );

  assert.equal(image, "default");
});

test("imageSource falls back when gallery metadata is incomplete", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
      is_gallery: true,
      gallery_data: {
        items: [{ media_id: "missing-media" }],
      },
      media_metadata: {},
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => "",
    }
  );

  assert.equal(image, "default");
});

test("imageSource falls back when preview image data is incomplete", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
      preview: {
        images: [{}],
      },
      url: "https://publisher.example/story",
    },
    {
      fetchArticleImageImpl: async () => "",
    }
  );

  assert.equal(image, "default");
});

test("imageSource prefers url_overridden_by_dest for article metadata", async () => {
  let articleUrl;

  const image = await imageSource(
    {
      thumbnail: "",
      url: "https://reddit.example/comments/story",
      url_overridden_by_dest: "https://publisher.example/canonical-story",
    },
    {
      fetchArticleImageImpl: async (url) => {
        articleUrl = url;
        return "https://publisher.example/image.jpg";
      },
    }
  );

  assert.equal(articleUrl, "https://publisher.example/canonical-story");
  assert.equal(image, "https://publisher.example/image.jpg");
});

test("imageSource falls back to thumbnail when no article URL is available", async () => {
  const image = await imageSource(
    {
      thumbnail: "default",
    },
    {
      fetchArticleImageImpl: async () => {
        throw new Error("article metadata should not be fetched");
      },
    }
  );

  assert.equal(image, "default");
});

test("mapWithConcurrency caps concurrently running work", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maxActive, 2);
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

test("selectPublicAddress returns null when no public address exists", () => {
  assert.equal(
    selectPublicAddress([
      { address: "10.0.0.5", family: 4 },
      { address: "example.com" },
    ]),
    null
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

test("makeSafeLookup returns a single selected address by default", async () => {
  const lookup = makeSafeLookup(async () => [
    { address: "151.101.193.111", family: 4 },
  ]);

  const result = await new Promise((resolve, reject) => {
    lookup("example.com", {}, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ address, family });
    });
  });

  assert.deepEqual(result, { address: "151.101.193.111", family: 4 });
});

test("makeSafeLookup rejects when DNS has no public addresses", async () => {
  const lookup = makeSafeLookup(async () => [
    { address: "10.0.0.5", family: 4 },
  ]);

  await assert.rejects(
    new Promise((resolve, reject) => {
      lookup("example.com", {}, (error, address) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address);
      });
    }),
    /Blocked private article metadata address/
  );
});

test("fetchArticleImage returns empty when fetch does not settle before timeout", async () => {
  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });

  assert.equal(image, "");
});
