import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '../test-utils';
import { ModalContext } from '../Contexts/ModalContext';
import { PostCard, getHeatTone, neutralCardTone } from './PostCard';

const post = {
  title: 'Existing headline',
  url: 'https://example.com/story',
  thumbnail: 'https://example.com/image.jpg',
  commentCount: 12,
  upvoteCount: 542,
  created_utc: Math.floor(Date.now() / 1000),
  domain: 'example.com',
  commentLink: '/r/news/comments/abc123/example',
  post_hint: 'image',
};

const renderPostCard = setModalData =>
  render(
    <ModalContext.Provider value={{ setModalData }}>
      <PostCard post={post} elId={0} />
    </ModalContext.Provider>
  );

describe('PostCard', () => {
  test('uses the original F5 News semantic heat colors for hot posts', () => {
    expect(getHeatTone(100)).toMatchObject({
      description: 'Rising',
      intensity: 1,
      heatColor: 'trending',
      cardBg: {
        light: 'trending',
        dark: 'trending',
      },
    });
    expect(getHeatTone(250)).toMatchObject({
      description: 'Hot',
      intensity: 2,
      heatColor: 'hot',
      cardBg: {
        light: 'hot',
        dark: 'hot',
      },
    });
    expect(getHeatTone(500)).toMatchObject({
      description: 'F5 O Clock',
      intensity: 3,
      heatColor: 'f5oclock',
      cardBg: {
        light: 'f5oclock',
        dark: 'f5oclock',
      },
    });
    expect(getHeatTone(5438)).toMatchObject({
      description: 'Surging',
      intensity: 4,
      heatColor: 'f5oclockStrong',
      cardBg: {
        light: 'f5oclockStrong',
        dark: 'f5oclockStrong',
      },
    });
    expect(getHeatTone(13683)).toMatchObject({
      description: 'Front Page',
      intensity: 5,
      heatColor: 'f5oclockPeak',
      cardBg: {
        light: 'f5oclockPeak',
        dark: 'f5oclockPeak',
      },
    });
    expect(getHeatTone(5438).cardBg.light).not.toBe(getHeatTone(13683).cardBg.light);
    expect(getHeatTone(5438).cardBg.dark).not.toBe(getHeatTone(13683).cardBg.dark);
  });

  test('renders clear article and reddit actions', () => {
    renderPostCard(vi.fn());

    expect(
      screen
        .getAllByRole('link')
        .filter(link => link.getAttribute('href') === post.url)
    ).toHaveLength(2);
    expect(screen.getAllByLabelText(/open reddit comments for existing headline/i).length).toBeGreaterThan(0);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  test('colors the card surface instead of rendering a heat badge', () => {
    renderPostCard(vi.fn());

    expect(screen.getByTestId('post-card')).toHaveAttribute('data-heat-intensity', '3');
    expect(screen.queryByText('Heat')).not.toBeInTheDocument();
  });

  test('uses the original gray dark fallback for non-hot cards', () => {
    expect(neutralCardTone.light).toMatchObject({
      bg: 'white',
      borderColor: 'gray.200',
      hoverBorderColor: 'blue.700',
    });
    expect(neutralCardTone.dark).toMatchObject({
      bg: 'gray.900',
      borderColor: 'gray.700',
      hoverBorderColor: 'blue.900',
    });
  });

  test('reserves title space so card actions stay bottom aligned', () => {
    renderPostCard(vi.fn());

    expect(screen.getByTestId('post-card-title-zone')).toHaveStyle({
      minHeight: '4.5rem',
    });
    expect(screen.getByTestId('post-card-actions')).toHaveStyle({
      marginTop: 'auto',
    });
  });

  test('uses an explicit preview action for media posts', () => {
    const setModalData = vi.fn();
    renderPostCard(setModalData);

    fireEvent.click(screen.getByLabelText(/preview image: existing headline/i));

    expect(setModalData).toHaveBeenCalledWith(post);
  });

  test('treats rich video embeds as external articles instead of previews', () => {
    const setModalData = vi.fn();

    render(
      <ModalContext.Provider value={{ setModalData }}>
        <PostCard
          post={{
            ...post,
            post_hint: 'rich:video',
            media: {
              oembed: {
                html: '&lt;iframe src=&quot;https://example.com/embed&quot;&gt;&lt;/iframe&gt;',
              },
            },
          }}
          elId={0}
        />
      </ModalContext.Provider>
    );

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/article/i)).toBeInTheDocument();
    expect(setModalData).not.toHaveBeenCalled();
  });
});
