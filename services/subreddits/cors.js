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

  return new Set([
    `https://${primaryDomainName}`,
    `https://www.${primaryDomainName}`,
  ]);
};

const ALLOWED_ORIGINS = getAllowedOrigins();

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
  ALLOWED_ORIGINS,
  createCorsHeaders,
  getAllowedOrigins,
  isAllowedOrigin: (origin) => getAllowedOrigins().has(origin),
};
