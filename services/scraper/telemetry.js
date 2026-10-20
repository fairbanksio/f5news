const sanitizeUrl = (value) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "[redacted-url]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[redacted-url]";
  }
};

const sanitizeText = (value, limit = 500, secrets = []) => {
  let text = String(value || "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[redacted-db-url]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, sanitizeUrl)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\b(password|passwd|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, limit);
};

const errorFields = (error, secrets = []) => ({
  errorName: sanitizeText(error?.name || "Error", 100, secrets),
  errorMessage: sanitizeText(error?.message || "Operation failed", 500, secrets),
  ...(error?.code !== undefined ? { errorCode: sanitizeText(error.code, 100, secrets) } : {}),
  ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
  ...(error?.stack ? { stack: sanitizeText(error.stack, 4096, secrets) } : {}),
});

const sanitizeImageFailure = (failure, secrets = []) => {
  const sanitized = { url: sanitizeUrl(failure.url), reason: sanitizeText(failure.reason) };
  for (const field of ["status", "redirectCount", "retryCount", "timeoutMs", "bytesRead", "maxRedirects"]) {
    if (Number.isFinite(failure[field])) sanitized[field] = failure[field];
  }
  for (const field of ["contentType", "server", "xCache", "xDatadome", "errorName", "errorMessage", "errorCode", "stack"]) {
    if (failure[field] !== undefined) sanitized[field] = sanitizeText(failure[field], field === "stack" ? 4096 : 500, secrets);
  }
  return sanitized;
};

module.exports = { errorFields, sanitizeImageFailure, sanitizeUrl };
