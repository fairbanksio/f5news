const normalizeFetch = (fetchImpl) => {
  if (typeof fetchImpl === "function") {
    return fetchImpl;
  }

  if (fetchImpl && typeof fetchImpl.default === "function") {
    return fetchImpl.default;
  }

  return fetchImpl;
};

module.exports = {
  normalizeFetch,
};
