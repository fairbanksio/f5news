const DEFAULT_PRIMARY_DOMAIN_NAME = "f5.news";

const normalizeDomainName = (domainName) => (
  domainName
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
);

const getPrimaryDomainName = () => normalizeDomainName(
  process.env.PRIMARY_DOMAIN_NAME || DEFAULT_PRIMARY_DOMAIN_NAME
);

const getAllowedOrigins = () => {
  const primaryDomainName = getPrimaryDomainName();

  const origins = new Set([
    `https://${primaryDomainName}`,
    `https://www.${primaryDomainName}`,
  ]);
  if (process.env.IS_OFFLINE === "true" && !process.env.AWS_EXECUTION_ENV) {
    for (const host of ["localhost", "127.0.0.1"]) {
      for (const port of [3000, 5173]) origins.add(`http://${host}:${port}`);
    }
    if (process.env.LOCAL_FRONTEND_ORIGIN) {
      try {
        const localOrigin = new URL(process.env.LOCAL_FRONTEND_ORIGIN);
        if (localOrigin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(localOrigin.hostname) &&
          !localOrigin.username && !localOrigin.password && localOrigin.pathname === "/" &&
          !localOrigin.search && !localOrigin.hash) origins.add(localOrigin.origin);
      } catch {
        // Ignore invalid local origins rather than relaxing the allowlist.
      }
    }
  }
  return origins;
};

const createCorsHeaders = (origin) => {
  if (!getAllowedOrigins().has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
};

module.exports = {
  createCorsHeaders,
  getAllowedOrigins,
  isAllowedOrigin: (origin) => getAllowedOrigins().has(origin),
};
