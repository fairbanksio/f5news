import { getVideoUrl } from './media';

test.each([
  'https://v.redd.it/story/DASHPlaylist.mpd',
  'https://media.publisher.example/story/video.mpd',
  'http://media.publisher.example/story/video.mpd',
])('accepts a valid media URL supplied by Reddit: %s', dash_url => {
  expect(getVideoUrl({ is_video: true, media: { reddit_video: { dash_url } } })).toBe(dash_url);
});

test('accepts an RPAN stream hosted outside Reddit', () => {
  const hls_url = 'https://stream.publisher.example/story/index.m3u8';
  expect(getVideoUrl({ rpan_video: { hls_url } })).toBe(hls_url);
});

test.each([undefined, '', 'not a URL', 'javascript:void(0)', 'data:video/mp4;base64,', 'https://user:password@example.com/video.mpd'])('rejects malformed or unsupported media URLs: %s', dash_url => {
  expect(getVideoUrl({ is_video: true, media: { reddit_video: { dash_url } } })).toBe('');
});
