const sanitizeDiagnostic = (value, limit) => {
  let text = String(value || "");
  const connectionString = process.env.MONGO_CONNECTION_STRING;
  if (connectionString) text = text.split(connectionString).join("[redacted]");
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[redacted-url]").slice(0, limit);
};

const errorFields = (error) => ({
  errorType: sanitizeDiagnostic(error?.name || "Error", 100),
  errorCode: sanitizeDiagnostic(error?.code, 100),
  errorMessage: sanitizeDiagnostic(error?.message || error, 512),
  stack: sanitizeDiagnostic(error?.stack, 4096),
});

module.exports = { errorFields };
