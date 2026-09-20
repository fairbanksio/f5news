import { getVideoUrl } from './media';

test('accepts the expected Reddit DASH and RPAN origins', () => {
  expect(getVideoUrl({ is_video: true, media: { reddit_video: { dash_url: 'https://v.redd.it/story/DASHPlaylist.mpd' } } })).toBe('https://v.redd.it/story/DASHPlaylist.mpd');
  expect(getVideoUrl({ rpan_video: { hls_url: 'https://livestream.redd.it/story/index.m3u8' } })).toBe('https://livestream.redd.it/story/index.m3u8');
});

test.each([undefined, '', 'not a URL', 'https://example.com/video.mpd', 'http://v.redd.it/video.mpd'])('does not pass unsupported media URLs to the player', dash_url => {
  expect(getVideoUrl({ is_video: true, media: { reddit_video: { dash_url } } })).toBe('');
});
