export const getRuntimeConfigValue = key => {
  const viteValue = import.meta.env?.[key] || import.meta.env?.[`VITE_${key}`];

  if (viteValue) {
    return viteValue;
  }

  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key];
  }

  if (typeof window !== 'undefined' && window[key]) {
    return window[key];
  }

  return undefined;
};

export const normalizeApiEndpoint = endpoint => {
  const normalizedEndpoint = endpoint.replace(/\/$/, '');
  return /^https?:\/\//.test(normalizedEndpoint)
    ? normalizedEndpoint
    : 'https://' + normalizedEndpoint;
};
