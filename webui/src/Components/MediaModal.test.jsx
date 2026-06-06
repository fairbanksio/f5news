import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../test-utils';
import { ModalContext } from '../Contexts/ModalContext';
import { MediaModal } from './MediaModal';

vi.mock('react-player', () => ({
  default: props => (
    <div data-testid="react-player" data-url={props.url} />
  ),
}));

beforeAll(() => {
  Object.defineProperty(window, 'focus', {
    writable: true,
    value: vi.fn(),
  });
});

let consoleErrorSpy;
const originalConsoleError = console.error;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
    if (String(message).includes('Not implemented: window.focus')) {
      return;
    }

    originalConsoleError(message, ...args);
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

const renderMediaModal = (modalData, setModalData = vi.fn()) => {
  render(
    <ModalContext.Provider value={{ modalData, setModalData }}>
      <MediaModal />
    </ModalContext.Provider>
  );

  return setModalData;
};

test('renders nothing when no modal data is selected', () => {
  renderMediaModal(null);

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('renders an image preview and closes it', async () => {
  const setModalData = renderMediaModal({
    post_hint: 'image',
    thumbnail: 'https://example.com/image.jpg',
  });

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    'https://example.com/image.jpg'
  );

  fireEvent.click(screen.getByRole('button', { name: /close/i }));

  await waitFor(() => expect(setModalData).toHaveBeenCalledWith(null));
});

test('renders gallery images after decoding reddit amp fragments', () => {
  renderMediaModal({
    is_gallery: true,
    media_metadata: {
      first: { s: { u: 'https://example.com/one.jpg?x=1&amp;y=2' } },
      second: { s: { u: 'https://example.com/two.jpg' } },
    },
  });

  const images = screen.getAllByRole('img');

  expect(images).toHaveLength(2);
  expect(images[0]).toHaveAttribute('src', 'https://example.com/one.jpg?x=1&y=2');
  expect(images[1]).toHaveAttribute('src', 'https://example.com/two.jpg');
});

test('renders reddit video previews with the player URL', () => {
  renderMediaModal({
    is_video: true,
    media: {
      reddit_video: {
        dash_url: 'https://example.com/video.mpd',
      },
    },
  });

  expect(screen.getByTestId('react-player')).toHaveAttribute(
    'data-url',
    'https://example.com/video.mpd'
  );
});

test('renders rpan video previews with the player URL', () => {
  renderMediaModal({
    rpan_video: {
      hls_url: 'https://example.com/live.m3u8',
    },
  });

  expect(screen.getByTestId('react-player')).toHaveAttribute(
    'data-url',
    'https://example.com/live.m3u8'
  );
});

test('does not render rich video embeds from oembed html', () => {
  renderMediaModal({
    post_hint: 'rich:video',
    media: {
      oembed: {
        html: '&lt;iframe title=&quot;Video embed&quot; src=&quot;https://example.com/embed&quot;&gt;&lt;/iframe&gt;',
      },
    },
  });

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Video embed')).not.toBeInTheDocument();
});
