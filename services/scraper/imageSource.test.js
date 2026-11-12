const assert = require("assert");
const { Readable } = require("stream");
const test = require("node:test");

const {
  extractMetaImage,
  fetchArticleImage,
  makeSafeLookup,
  imageSource,
  imageUrlWidth,
  isSmallRedditThumbnail,
  fetchImageWidth,
  imageWidthFromBytes,
  isSafeHttpUrl,
  mapWithConcurrency,
  selectPublicAddress,
} = require("./imageSource");

const createHeaders = (values = {}) => ({
  get: (name) => values[name.toLowerCase()] || null,
});

test("publisher-only article and image requests never follow redirects to Reddit", async () => {
  for (const resolve of [fetchArticleImage, fetchImageWidth]) {
    const requests = [];
    const result = await resolve("https://publisher.example/story", {
      publisherOnly: true,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (url) => {
        requests.push(url);
        return { status: 302, headers: createHeaders({ location: "https://preview.redd.it./image.jpg" }) };
      },
    });
    assert.ok(!result);
    assert.deepEqual(requests, ["https://publisher.example/story"]);
  }
});

test("publisher-only resolution neither returns a Reddit fallback nor accepts Reddit publisher metadata", async () => {
  const data = { url: "https://publisher.example/story", thumbnail: "https://preview.redd.it/image.jpg?width=140" };
  assert.equal(await imageSource(data, { publisherOnly: true, fetchArticleImageImpl: async () => "" }), "");
  assert.equal(await imageSource(data, {
    publisherOnly: true,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true, status: 200, headers: createHeaders({ "content-type": "text/html" }),
      body: Readable.from(['<meta property="og:image" content="https://preview.redd.it/image.jpg">']),
    }),
  }), "");
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
  const failures = [];

  const image = await fetchArticleImage("http://127.0.0.1/article", {
    onArticleImageFailure: (failure) => failures.push(failure),
    fetchImpl: async () => {
      fetchCalled = true;
    },
  });

  assert.equal(image, "");
  assert.equal(fetchCalled, false);
  assert.deepEqual(failures, [
    {
      url: "http://127.0.0.1/article",
      reason: "unsafe_url",
      redirectCount: 0,
      retryCount: 0,
    },
  ]);
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

test("publisher DNS permits public 192.0 addresses and rejects reserved blocks", async () => {
  const url = "https://publisher.example/story";
  const check = (...addresses) => isSafeHttpUrl(url, {
    resolveHostname: async () => addresses.map(address => ({ address, family: 4 })),
  });
  assert.equal(await check("192.0.78.235", "192.0.78.132"), true);
  assert.equal(await check("192.0.0.8"), false);
  assert.equal(await check("192.0.2.1"), false);
  assert.equal(await check("192.0.78.235", "192.0.0.8"), false);
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

test("fetchArticleImage reports blocked publisher response details", async () => {
  const failures = [];

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    onArticleImageFailure: (failure) => failures.push(failure),
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: createHeaders({
        "content-type": "text/html;charset=utf-8",
        server: "CloudFront",
        "x-cache": "LambdaGeneratedResponse from cloudfront",
        "x-datadome": "protected",
      }),
      body: {
        destroy: () => {},
      },
    }),
  });

  assert.equal(image, "");
  assert.deepEqual(failures, [
    {
      url: "https://publisher.example/story",
      reason: "http_status",
      status: 401,
      contentType: "text/html;charset=utf-8",
      server: "CloudFront",
      xCache: "LambdaGeneratedResponse from cloudfront",
      xDatadome: "protected",
      redirectCount: 0,
      retryCount: 0,
    },
  ]);
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

test("fetchArticleImage reports when article HTML has no image metadata", async () => {
  const failures = [];

  const image = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    onArticleImageFailure: (failure) => failures.push(failure),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        "content-type": "text/html; charset=utf-8",
        server: "publisher",
      }),
      text: async () => "<html><head><title>No image</title></head></html>",
    }),
  });

  assert.equal(image, "");
  assert.deepEqual(failures, [
    {
      url: "https://publisher.example/story",
      reason: "no_meta_image",
      status: 200,
      contentType: "text/html; charset=utf-8",
      server: "publisher",
      xCache: "",
      xDatadome: "",
      redirectCount: 0,
      retryCount: 0,
      bytesRead: 49,
    },
  ]);
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

test("Reddit flags do not suppress supplied preview images", async () => {
  for (const hidden of [
    { spoiler: true }, { over_18: true },
    { thumbnail: "nsfw" }, { thumbnail: "spoiler" },
  ]) {
    let requests = 0;
    const result = await imageSource({
      url: "https://publisher.example/story",
      preview: { images: [{ source: { url: "https://preview.redd.it/photo.jpg" } }] },
      ...hidden,
    }, { fetchArticleImageImpl: async () => { requests += 1; return "image"; } });
    assert.equal(result, "https://preview.redd.it/photo.jpg");
    assert.equal(requests, 0);
  }
});

test("publisher response is closed when reading its body fails", async () => {
  let closed = 0;
  const result = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    maxTransientRetries: 0,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({ "content-type": "text/html" }),
      body: { destroy: () => { closed += 1; } },
      text: async () => { throw new Error("read failed"); },
    }),
  });
  assert.equal(result, "");
  assert.equal(closed, 1);
});

test("ordinary Reddit images remain usable when preview.enabled is false", async () => {
  const image = "https://media.publisher.example/photo.jpg";
  assert.equal(await imageSource({
    spoiler: false,
    over_18: false,
    preview_disabled: true,
    preview: { enabled: false, images: [{ source: { url: image } }] },
    url: "https://publisher.example/story",
  }, { fetchArticleImageImpl: async () => { throw new Error("unexpected fallback"); } }), image);
});

test("preview.enabled does not prevent ordinary publisher image fallback", async () => {
  let requests = 0;
  const image = await imageSource({
    preview: { enabled: false },
    thumbnail: "default",
    url: "https://publisher.example/story",
  }, { fetchArticleImageImpl: async () => { requests += 1; return "https://publisher.example/photo.jpg"; } });
  assert.equal(image, "https://publisher.example/photo.jpg");
  assert.equal(requests, 1);
});

test("article preference upgrades only small external link thumbnails", async () => {
  const thumbnail = "https://external-preview.redd.it/story.jpg?width=140&amp;auto=webp";
  const data = { thumbnail, url: "https://publisher.example/story" };
  let calls = 0;
  const fetchArticleImageImpl = async () => { calls += 1; return "https://publisher.example/full.jpg"; };
  assert.equal(await imageSource(data, { fetchArticleImageImpl }), thumbnail.replace(/amp;/g, ""));
  assert.equal(calls, 0);
  assert.equal(await imageSource(data, { preferArticleImage: true, fetchArticleImageImpl }), "https://publisher.example/full.jpg");
  assert.equal(calls, 1);
  assert.equal(await imageSource({ ...data, thumbnail: "https://preview.redd.it/story.jpg?width=320" }, { preferArticleImage: true, fetchArticleImageImpl }), "https://publisher.example/full.jpg");
  assert.equal(calls, 2);
});

test("article preference preserves the small thumbnail after empty results or errors", async () => {
  const data = { thumbnail: "https://external-preview.redd.it/story.jpg?width=140&amp;auto=webp", url: "https://publisher.example/story" };
  const expected = data.thumbnail.replace(/amp;/g, "");
  assert.equal(await imageSource(data, { preferArticleImage: true, fetchArticleImageImpl: async () => "" }), expected);
  const failures = [];
  assert.equal(await imageSource(data, {
    preferArticleImage: true,
    fetchArticleImageImpl: async () => { throw new Error("publisher blocked metadata"); },
    onArticleImageFailure: (failure) => failures.push(failure),
  }), expected);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "fetch_error");
});

test("article preference tries the publisher when Reddit only supplies a small preview", async () => {
  const thumbnail = "https://external-preview.redd.it/story.jpg?width=140";
  const photo = "https://publisher.example/full.jpg";
  const article = "https://publisher.example/story";
  const result = await imageSource({
    preview: { images: [{ source: { url: thumbnail, width: 140 } }] },
    url: article,
  }, {
    preferArticleImage: true,
    fetchArticleImageImpl: async url => {
      assert.equal(url, article);
      return photo;
    },
  });
  assert.equal(result, photo);
});

test("article preference keeps full previews and media behavior", async () => {
  const data = { thumbnail: "https://external-preview.redd.it/story.jpg?width=140", url: "https://publisher.example/story" };
  const options = { preferArticleImage: true, fetchArticleImageImpl: async () => { throw new Error("Unexpected article fetch"); } };
  let calls = 0;
  options.fetchArticleImageImpl = async () => { calls += 1; return "https://publisher.example/full.jpg"; };
  const preview = "https://preview.redd.it/full.jpg?width=1200";
  assert.equal(await imageSource({ ...data, preview: { images: [{ source: { url: preview } }] } }, options), preview);
  const gallery = { ...data, is_gallery: true, gallery_data: { items: [{ media_id: "photo" }] }, media_metadata: { photo: { s: { u: preview } } } };
  assert.equal(await imageSource(gallery, options), preview);
  for (const flags of [{ is_video: true }, { is_self: true }, { post_hint: "image" }, { post_hint: "rich:video" }, { rpan_video: {} }, { is_gallery: true }]) {
    assert.equal(await imageSource({ ...data, ...flags }, options), data.thumbnail);
  }
  assert.equal(calls, 0);
});

test("article preference leaves large, invalid-size, and Reddit destination thumbnails alone", async () => {
  let calls = 0;
  const options = { preferArticleImage: true, fetchArticleImageImpl: async () => { calls += 1; return "https://publisher.example/full.jpg"; } };
  for (const query of ["width=321", "width=640", "width=0", "width=-1", "width=140px", "width=140&width=640"]) {
    const thumbnail = `https://external-preview.redd.it/story.jpg?${query}`;
    assert.equal(await imageSource({ thumbnail, url: "https://publisher.example/story" }, options), thumbnail);
  }
  for (const url of ["https://www.reddit.com/r/news/comments/abc/story/", "https://i.redd.it/photo.jpg"]) {
    const thumbnail = "https://preview.redd.it/story.jpg?width=140";
    assert.equal(await imageSource({ thumbnail, url }, options), thumbnail);
  }
  assert.equal(calls, 0);
});

test("article preference handles legacy Reddit thumbnails without a width parameter", async () => {
  for (const thumbnail of ["https://a.thumbs.redditmedia.com/story.jpg", "https://b.thumbs.redditmedia.com/story.jpg"]) {
    assert.equal(await imageSource({ thumbnail, url: "https://publisher.example/story" }, {
      preferArticleImage: true,
      fetchArticleImageImpl: async () => "https://publisher.example/full.jpg",
    }), "https://publisher.example/full.jpg");
  }
  assert.equal(isSmallRedditThumbnail("https://publisher.example/full.jpg"), false);
  assert.equal(isSmallRedditThumbnail("https://external-preview.redd.it/story.jpg"), false);
  assert.equal(isSmallRedditThumbnail("https://external-preview.redd.it/story.jpg?width=1080"), false);
  assert.equal(imageUrlWidth("https://external-preview.redd.it/story.jpg?width=140&width=1080"), null);
});

test("Reddit previews select a larger published resolution without fetching the article", async () => {
  const high = "https://external-preview.redd.it/story.jpg?width=1080&s=actual-signature";
  assert.equal(await imageSource({
    url: "https://publisher.example/story",
    preview: { images: [{
      source: { url: "https://external-preview.redd.it/story.jpg?width=140", width: 140 },
      resolutions: [{ url: high, width: 1080 }],
    }] },
  }, { preferArticleImage: true, fetchArticleImageImpl: async () => { throw new Error("unexpected article fetch"); } }), high);
});

test("an original Reddit preview of unknown size keeps priority over a known resized variant", async () => {
  const original = "https://i.redd.it/original.jpg";
  assert.equal(await imageSource({ preview: { images: [{ source: { url: original }, resolutions: [{ url: "https://preview.redd.it/photo.jpg?width=1080", width: 1080 }] }] } }), original);
});

const pngHeader = (width) => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  return bytes;
};

test("image width reads PNG, JPEG and WebP headers without decoding full images", () => {
  assert.equal(imageWidthFromBytes(pngHeader(1200)), 1200);
  assert.equal(imageWidthFromBytes(Buffer.from([255, 216, 255, 192, 0, 7, 8, 0, 78, 0, 140])), 140);
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUIntLE(1079, 24, 3);
  assert.equal(imageWidthFromBytes(webp), 1080);
  assert.equal(imageWidthFromBytes(Buffer.from("not an image")), null);
});

test("image width probing uses a bounded range and pinned public DNS agent", async () => {
  let options;
  assert.equal(await fetchImageWidth("https://cdn.example/photo.png", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (_url, request) => { options = request; return { ok: true, status: 200, body: Readable.from([pngHeader(1200)]) }; },
  }), 1200);
  assert.deepEqual(options.headers, { Accept: "image/*", Range: "bytes=0-65535" });
  assert.equal(options.redirect, "manual");
  assert.equal(typeof options.agent, "function");
});

test("native Web streams stop and cancel when the image header byte limit is reached", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({ pull(controller) {
    pulls += 1;
    controller.enqueue(pulls === 1 ? pngHeader(1080) : Buffer.alloc(64 * 1024));
  }, cancel() { cancelled = true; } });
  assert.equal(await fetchImageWidth("https://cdn.example/photo.png", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({ ok: true, status: 200, body }),
  }), 1080);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3);
});

test("image probing rejects private destinations and private redirects", async () => {
  let calls = 0;
  const options = {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => { calls += 1; return { ok: false, status: 302, headers: createHeaders({ location: "http://127.0.0.1/private" }) }; },
  };
  assert.equal(await fetchImageWidth("http://127.0.0.1/private", options), null);
  assert.equal(calls, 0);
  assert.equal(await fetchImageWidth("https://cdn.example/image", options), null);
  assert.equal(calls, 1);
  assert.equal(await fetchImageWidth("https://cdn.example/image", { ...options, resolveHostname: async () => [{ address: "10.0.0.1", family: 4 }] }), null);
  assert.equal(calls, 1);
});

test("image probing has one hard deadline and no retries", async () => {
  let calls = 0;
  assert.equal(await fetchImageWidth("https://cdn.example/image", {
    imageTimeoutMs: 5,
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => { calls += 1; return new Promise(() => {}); },
  }), null);
  assert.equal(calls, 1);
});


test("publisher metadata skips unsafe candidates and preserves valid Open Graph priority", () => {
  const page = "https://publisher.example/story";
  for (const unsafe of ["data:image/png;base64,abc", "javascript:alert(1)", "http://127.0.0.1/private.jpg", "http://[::1]/private.jpg", "http://localhost/private.jpg", "https://user:secret@cdn.example/private.jpg"]) {
    assert.equal(extractMetaImage(`<meta property="og:image" content="${unsafe}">
      <meta name="twitter:image" content="/twitter.jpg"><meta property="og:image" content="/valid.jpg">`, page),
    "https://publisher.example/valid.jpg");
  }
  assert.equal(extractMetaImage('<meta property="og:image" content="data:bad"><meta name="twitter:image" content="/twitter.jpg"><link rel="image_src" href="/linked.jpg">', page), "https://publisher.example/twitter.jpg");
});

test("publisher image metadata falls back to an explicit image source link", () => {
  assert.equal(extractMetaImage('<link REL="alternate image_src" href="/published.jpg?x=1&amp;y=2">', "https://publisher.example/story"),
    "https://publisher.example/published.jpg?x=1&y=2");
});

test("publisher JSON-LD uses article image fields without selecting publisher logos", () => {
  const html = `<script type="application/ld+json">not json</script>
    <script type="application/ld+json">${JSON.stringify({ "@graph": [
    { "@type": "Organization", image: "/logo.jpg" },
    { "@type": ["NewsArticle"], publisher: { logo: "/another-logo.jpg" }, image: [{ url: "data:bad" }, { "@type": "ImageObject", contentUrl: "/article.jpg" }] },
  ] })}</script>`;
  assert.equal(extractMetaImage(html, "https://publisher.example/story"), "https://publisher.example/article.jpg");
  assert.equal(extractMetaImage(`<link rel="image_src" href="/declared.jpg">${html}`, "https://publisher.example/story"), "https://publisher.example/declared.jpg");
});

test("publisher fallback uses the published full-size image anchor inside main content", () => {
  const html = `<header><a href="/masthead.jpg"><img width="900" height="200" src="/masthead-small.jpg"></a></header>
    <main><header><a href="/header.jpg"><img width="600" height="300" src="/header-small.jpg"></a></header>
      <aside><a href="/sidebar.jpg"><img width="300" height="176" src="/sidebar-small.jpg"></a></aside>
      <a href="/brand-logo.jpg"><img width="300" height="176" src="/brand-small.jpg" alt="Publisher logo"></a>
      <article><a href="https://media.publisher.example/poster.jpg"><img width=300 height=176 src="https://media.publisher.example/poster-300x176.jpg"></a></article>
    </main><footer><a href="/footer.jpg"><img width="600" height="300" src="/footer-small.jpg"></a></footer>`;
  assert.equal(extractMetaImage(html, "https://publisher.example/story"), "https://media.publisher.example/poster.jpg");
});

test("publisher content fallback rejects arbitrary images, unsafe links, and undersized decorations", () => {
  const page = "https://publisher.example/story";
  for (const html of [
    '<a href="/outside.jpg"><img width="300" height="176" src="/small.jpg"></a>',
    '<main><img width="1200" height="800" src="/unlinked.jpg"></main>',
    '<article><a href="/other-story"><img width="300" height="176" src="/small.jpg"></a></article>',
    '<main><a href="/photo.jpg"><img width="299" height="176" src="/small.jpg"></a></main>',
    '<main><a href="/photo.jpg"><img width="300" height="149" src="/small.jpg"></a></main>',
    '<main><a href="http://127.0.0.1/private.jpg"><img width="300" height="176" src="/small.jpg"></a></main>',
    '<script>const html = `<main><a href="/fake.jpg"><img width="300" height="176" src="/small.jpg"></a></main>`;</script>',
  ]) assert.equal(extractMetaImage(html, page), "");
});

test("publisher content fallback stays within the existing HTML byte limit", () => {
  const image = '<main><a href="/photo.jpg"><img width="300" height="176" src="/small.jpg"></a></main>';
  assert.equal(extractMetaImage(" ".repeat(512 * 1024) + image, "https://publisher.example/story"), "");
});

test("publisher fallback does not add a request beyond the article fetch", async () => {
  let requests = 0;
  const result = await fetchArticleImage("https://publisher.example/story", {
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, status: 200, headers: createHeaders({ "content-type": "text/html" }),
        body: Readable.from(['<main><a href="/poster.jpg"><img width="300" height="176" src="/poster-300x176.jpg"></a></main>']) };
    },
  });
  assert.equal(result, "https://publisher.example/poster.jpg");
  assert.equal(requests, 1);
});

test("missing self, video, gallery, and internal Reddit images never fetch publisher pages", async () => {
  for (const data of [
    { is_self: true, url: "https://publisher.example/story" },
    { is_video: true, url: "https://publisher.example/story" },
    { is_gallery: true, gallery_data: { items: [{ media_id: "missing" }] }, url: "https://publisher.example/story" },
    { url: "https://www.reddit.com/r/news/comments/abc/story/" },
    { url: "https://i.redd.it/photo.jpg" },
  ]) {
    assert.equal(await imageSource({ ...data, thumbnail: "default" }, {
      fetchArticleImageImpl: async () => { throw new Error("Unexpected publisher fetch"); },
      onArticleImageFailure: () => assert.fail("Nonexternal posts must not attempt publisher fallback"),
    }), "default");
  }
});


test("a main sidebar image must explicitly identify the primary article heading", () => {
  const article = '<h1>Primary Article</h1><aside class="article-sidebar"><a aria-label=" primary   ARTICLE " href="/poster.jpg"><img width="300" height="176" src="/poster-300x176.jpg"></a></aside>';
  assert.equal(extractMetaImage(`<main>${article}</main>`, "https://publisher.example/story"), "https://publisher.example/poster.jpg");
  assert.equal(extractMetaImage(`<main>${article.replace('aria-label=" primary   ARTICLE "', 'title="Primary Article"')}</main>`, "https://publisher.example/story"), "https://publisher.example/poster.jpg");
  for (const html of [
    article.replace('aria-label=" primary   ARTICLE "', 'aria-label="Other Story"'),
    article.replace('aria-label=" primary   ARTICLE "', ''),
    `<h1>Second Heading</h1>${article}`,
    `<header>${article}</header>`,
    `<div class="related">${article}</div>`,
  ]) assert.equal(extractMetaImage(`<main>${html}</main>`, "https://publisher.example/story"), "");
});


test("a legacy main container requires its image anchor to identify the article heading", () => {
  const html = '<html class="html_logo_center"><body><div id="main"><div class="single-content-section"><h1 class="entry-title">Primary Article</h1></div><aside class="single-rewards-sidebar"><a class="rewards-poster-link" aria-label="Primary Article" href="/poster.jpg"><img width="300" height="176" src="/poster-300x176.jpg"></a></aside></div></body></html>';
  assert.equal(extractMetaImage(html, "https://publisher.example/story"), "https://publisher.example/poster.jpg");
  assert.equal(extractMetaImage(html.replace('aria-label="Primary Article"', ''), "https://publisher.example/story"), "");
});

test("HTTPS-only publisher image verification rejects non-default and unsafe redirects", async () => {
  for (const location of ["http://cdn.example/story.jpg", "https://cdn.example:8443/story.jpg",
    "https://user:password@cdn.example/story.jpg", "https://127.0.0.1/story.jpg"]) {
    const requests = [];
    assert.equal(await fetchImageWidth("https://publisher.example/story.jpg", {
      publisherOnly: true, httpsOnly: true,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (url) => {
        requests.push(url);
        return { status: 302, headers: createHeaders({ location }) };
      },
    }), null);
    assert.deepEqual(requests, ["https://publisher.example/story.jpg"]);
  }
});

const nytArticle = "https://www.nytimes.com/2026/11/11/us/politics/example.html";
const nytFeed = "https://rss.nytimes.com/services/xml/rss/nyt/US.xml";
const nytImage = "https://static01.nyt.com/images/example.jpg";
const nytThumbnail = "https://external-preview.redd.it/example.jpg?width=140";
const nytItem = (article, image = nytImage) =>
  `<item><link>${article}</link><media:content url="${image}" medium="image" width="1800" /></item>`;
const nytRssResponse = (items) => ({
  ok: true, status: 200, headers: createHeaders({ "content-type": "application/rss+xml" }),
  body: Readable.from([`<rss><channel>${items}</channel></rss>`]),
});
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

test("NYT RSS supplies an exact article image after metadata is unavailable and shares the feed request", async () => {
  const calls = [];
  const options = {
    preferArticleImage: true, resolveHostname: publicDns, maxTransientRetries: 0,
    fetchImpl: async (url, request) => {
      calls.push(url);
      if (url === nytFeed) return nytRssResponse(nytItem(nytArticle));
      if (url === nytImage) {
        assert.equal(request.headers.Range, "bytes=0-65535");
        return { ok: true, status: 206, body: Readable.from([pngHeader(1800)]) };
      }
      return { ok: false, status: 403, headers: createHeaders() };
    },
  };
  const results = await Promise.all([
    imageSource({ url: `${nytArticle}?smid=share#fragment`, thumbnail: nytThumbnail }, options),
    imageSource({ url: nytArticle.replace("www.nytimes.com", "nytimes.com") }, { ...options, publisherOnly: true }),
  ]);
  assert.deepEqual(results, [nytImage, nytImage]);
  assert.equal(calls.filter((url) => url === nytFeed).length, 1);
  assert.equal(calls.filter((url) => url === nytImage).length, 2);
});

test("NYT RSS skips unrelated articles, foreign image URLs and unverified image sizes", async () => {
  for (const [items, expectedProbes] of [
    [nytItem(nytArticle.replace("example.html", "similar-example.html")), 0],
    [nytItem(nytArticle, "https://cdn.example/wrong.jpg"), 0],
    [nytItem(nytArticle, "https://static01.nyt.com:8443/wrong.jpg"), 0],
    [nytItem(nytArticle), 1],
  ]) {
    let probes = 0;
    const result = await imageSource({ url: nytArticle, thumbnail: nytThumbnail }, {
      preferArticleImage: true, resolveHostname: publicDns, fetchArticleImageImpl: async () => "",
      fetchImpl: async (url) => {
        if (url === nytFeed) return nytRssResponse(items);
        probes += 1;
        return { ok: true, status: 206, body: Readable.from([pngHeader(140)]) };
      },
    });
    assert.equal(result, nytThumbnail);
    assert.equal(probes, expectedProbes);
  }
});

test("NYT RSS performs no fallback request after article success or an explicit HTTP 429", async () => {
  const data = { url: nytArticle, thumbnail: nytThumbnail };
  const options = {
    preferArticleImage: true, resolveHostname: publicDns,
    fetchImpl: async () => { assert.fail("Unexpected RSS or image request"); },
  };
  assert.equal(await imageSource(data, { ...options, fetchArticleImageImpl: async () => nytImage }), nytImage);
  assert.equal(await imageSource(data, {
    ...options,
    fetchArticleImageImpl: async (_url, { onArticleImageFailure }) => {
      onArticleImageFailure({ reason: "http_status", status: 429 });
      return "";
    },
  }), nytThumbnail);
});

test("NYT RSS has one bounded fetch with no follow-up after timeout or redirect", async () => {
  const data = { url: nytArticle, thumbnail: nytThumbnail };
  for (const response of ["timeout", "redirect"]) {
    const requests = [];
    const result = await imageSource(data, {
      timeoutMs: 25, preferArticleImage: true, resolveHostname: publicDns, fetchArticleImageImpl: async () => "",
      fetchImpl: async (url, options) => {
        requests.push({ url, ...options });
        return response === "timeout"
          ? new Promise(() => {})
          : { ok: false, status: 302, headers: createHeaders({ location: "https://public.example/feed" }) };
      },
    });
    assert.equal(result, nytThumbnail);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, nytFeed);
    assert.equal(requests[0].redirect, "manual");
    if (response === "timeout") assert.equal(requests[0].signal.aborted, true);
  }
});
