const VIDEO_ORIGINS = new Set(['https://v.redd.it', 'https://livestream.redd.it']);

export const getVideoUrl = post => {
  const candidate = post?.is_video
    ? post.media?.reddit_video?.dash_url
    : post?.rpan_video?.hls_url;
  if (typeof candidate !== 'string') return '';
  try {
    const url = new URL(candidate);
    return VIDEO_ORIGINS.has(url.origin) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
};
