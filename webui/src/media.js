export const getVideoUrl = post => {
  const candidate = post?.is_video
    ? post.media?.reddit_video?.dash_url
    : post?.rpan_video?.hls_url;
  if (typeof candidate !== 'string') return '';
  try {
    const url = new URL(candidate);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
};
