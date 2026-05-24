const ALLOWED_ORIGINS = new Set([
  "https://f5.news",
  "https://www.f5.news",
]);

const createCorsHeaders = (origin) => {
  if (!ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
};

module.exports = {
  ALLOWED_ORIGINS,
  createCorsHeaders,
  isAllowedOrigin: (origin) => ALLOWED_ORIGINS.has(origin),
};
