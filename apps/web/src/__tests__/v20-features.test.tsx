import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAvatar } from '../components/UserAvatar.tsx';
import { searchPublicCatalog } from '../services/social-service.ts';

describe('pMusic v0.20.0 social & Jam helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UserAvatar renders fallback initial when src is empty or image fails to load', () => {
    const { rerender } = render(<UserAvatar src={null} name="Danny" size="md" />);
    expect(screen.getByLabelText('Danny').textContent).toBe('D');

    rerender(<UserAvatar src="https://broken.invalid/avatar.jpg" name="Cruzzi" size="md" />);
    const img = screen.getByRole('img', { name: 'Cruzzi' });
    expect(img.getAttribute('referrerPolicy')).toBe('no-referrer');
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: 'Cruzzi' })).toBeNull();
    expect(screen.getByLabelText('Cruzzi').textContent).toBe('C');
  });

  it('searchPublicCatalog falls back cleanly to iTunes Search API when proxies fail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('dz-proxy')) {
        return new Response('Proxy unavailable', { status: 502 });
      }
      if (url.includes('itunes.apple.com/search')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                trackId: 998877,
                trackName: 'Me Muevo Con Dios',
                artistName: 'Cruzzi',
                collectionName: 'Me Muevo Con Dios',
                trackTimeMillis: 245000,
                artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
                trackExplicitness: 'explicit',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const hits = await searchPublicCatalog('Cruzzi');
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe('it:998877');
    expect(hits[0]?.title).toBe('Me Muevo Con Dios');
    expect(hits[0]?.thumbnailHighUrl).toContain('600x600bb');
  });
});
