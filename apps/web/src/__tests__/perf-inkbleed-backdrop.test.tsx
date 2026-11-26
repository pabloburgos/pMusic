// @vitest-environment jsdom
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  InkBleedCoverTransition,
  prefetchInkCoverImage,
  warmUpInkBleedWebGL,
} from '../components/InkBleedCoverTransition.tsx';
import {
  MobileFluidBackdropCanvas,
  prefetchFluidBackdropCover,
} from '../components/MobileFluidBackdropCanvas.tsx';
import { NowPlayingSheet } from '../components/Overlays.tsx';
import { TrackListRow } from '../components/Screens.tsx';
import {
  animateAmbientPaletteFromCover,
  getLiveAmbientQuadRef,
  getLiveAmbientRgbRef,
  prebakeMobileBackdrop,
  prefetchAmbientPaletteFromCover,
  trimBackdropMemoryCaches,
} from '../utils/cover-color.ts';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import type { Track } from '@pmusic/core';

function makeTrack(idx: number): Track {
  return {
    id: `perf-track-${idx}`,
    title: `Perf Track #${idx}`,
    artists: [{ id: `art-${idx}`, name: `Perf Artist ${idx}` }],
    album: { id: `alb-${idx}`, name: `Perf Album ${idx}` },
    durationSec: 210,
    thumbnailUrl: `https://example.com/perf-cover-${idx}.jpg`,
    thumbnailHighUrl: `https://example.com/perf-cover-${idx}.jpg`,
    source: 'youtube',
  };
}

function createMockWebGLContext() {
  const uniform1fCalls: Array<{ loc: unknown; val: number }> = [];
  let compileCount = 0;
  let drawCount = 0;
  const mockGl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    TRIANGLES: 0x0004,
    isContextLost: () => false,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(() => {
      compileCount++;
    }),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    deleteTexture: vi.fn(),
    createFramebuffer: vi.fn(() => ({})),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    deleteFramebuffer: vi.fn(),
    pixelStorei: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_prog: unknown, name: string) => ({ name })),
    useProgram: vi.fn(),
    viewport: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn((loc: unknown, val: number) => {
      uniform1fCalls.push({ loc, val });
    }),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    drawArrays: vi.fn(() => {
      drawCount++;
    }),
  };
  return {
    mockGl,
    uniform1fCalls,
    getCompileCount: () => compileCount,
    getDrawCount: () => drawCount,
  };
}

afterEach(() => {
  cleanup();
  trimBackdropMemoryCaches();
  vi.restoreAllMocks();
  document.documentElement.classList.remove('pm-np-canvas-open');
  act(() => {
    usePMusicStore.setState({
      nowPlayingOpen: false,
      isTransitioning: false,
      outgoingTransitionTrack: null,
      incomingTransitionTrack: null,
      nowPlayingBackdropStyle: 'fluid',
    });
  });
});

describe('Performance, WebGL Ink-Bleed Monotonicity & Zero-Jank Backdrop Suite', () => {
  it('keeps WebGL ink-bleed canvas opaque and strictly monotonic across parent re-renders and jittered RAF timestamps, and reuses pooled WebGL shaders', () => {
    const { mockGl, uniform1fCalls, getCompileCount } = createMockWebGLContext();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((kind: string) => {
        if (kind === 'webgl' || kind === 'experimental-webgl') {
          return mockGl as unknown as WebGLRenderingContext;
        }
        return null;
      });

    // Instant Image loader that succeeds on CORS
    const OrigImage = globalThis.Image;
    class InstantCorsImage {
      crossOrigin = '';
      decoding = '';
      complete = true;
      naturalWidth = 512;
      naturalHeight = 512;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      set src(val: string) {
        this._src = val;
        this.onload?.();
      }
      get src() {
        return this._src;
      }
    }
    globalThis.Image = InstantCorsImage as unknown as typeof Image;

    const rafQueue: Array<(t: number) => void> = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    try {
      // Pre-warm pooled WebGL engine once
      warmUpInkBleedWebGL();
      const compilesAfterWarmup = getCompileCount();
      expect(compilesAfterWarmup).toBe(4); // 2 programs * (VS + FS)

      let bumpParent: (() => void) | null = null;
      const ParentHarness: React.FC = () => {
        const [tick, setTick] = useState(0);
        bumpParent = () => setTick((t) => t + 1);
        return (
          <div data-tick={tick}>
            <InkBleedCoverTransition
              outgoingUrl="https://example.com/ink-a.jpg"
              outgoingTitle="Cover A"
              incomingUrl="https://example.com/ink-b.jpg"
              incomingTitle="Cover B"
              seedKey="a:b"
              durationSec={2}
            />
          </div>
        );
      };

      const { unmount } = render(<ParentHarness />);
      const wrap = screen.getByTestId('ink-bleed-cover');
      const canvases = Array.from(wrap.querySelectorAll('canvas'));
      const activeCanvas = canvases.find((c) => c.style.display !== 'none')!;
      const imgs = wrap.querySelectorAll('img');
      const outImg = imgs[1] as HTMLImageElement;

      // WebGL started immediately at t=0 -> canvas opaque, fallback outgoing hidden
      expect(activeCanvas.style.opacity).toBe('1');
      expect(outImg.style.opacity).toBe('0');

      // Advance RAF with deliberate backward timestamp jitter (-12ms) and force 5 parent re-renders mid-animation
      const timestamps = [1000, 1400, 1388, 1800, 2200, 3000];
      for (const ts of timestamps) {
        const cb = rafQueue.shift();
        if (cb) cb(ts);
        act(() => {
          bumpParent?.();
        });
        // Re-rendering the parent MUST NEVER reset canvas opacity to 0 or flip outgoing cover back to 1!
        expect(activeCanvas.style.opacity).toBe('1');
        expect(outImg.style.opacity).toBe('0');
      }

      // Verify u_pRaw progressed strictly monotonically (never decreased despite 1400 -> 1388 clock jitter)
      const pRawValues = uniform1fCalls
        .filter((c) => (c.loc as { name?: string })?.name === 'u_pRaw')
        .map((c) => c.val);
      expect(pRawValues.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < pRawValues.length; i++) {
        expect(pRawValues[i]!).toBeGreaterThanOrEqual(pRawValues[i - 1]!);
      }
      expect(pRawValues[0]).toBe(0);
      expect(pRawValues[pRawValues.length - 1]).toBe(1);

      unmount();

      // Second transition MUST reuse pooled WebGL context & compiled shaders (0 new shader compiles!)
      render(
        <InkBleedCoverTransition
          outgoingUrl="https://example.com/ink-b.jpg"
          outgoingTitle="Cover B"
          incomingUrl="https://example.com/ink-c.jpg"
          incomingTitle="Cover C"
          seedKey="b:c"
          durationSec={2}
        />
      );
      expect(getCompileCount()).toBe(compilesAfterWarmup);
      expect(getContextSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Image = OrigImage;
    }
  });

  it('retries CORS cover loads via /api/cover-proxy when direct crossOrigin image fails', () => {
    const requestedUrls: string[] = [];
    const OrigImage = globalThis.Image;
    class ProxyFallbackImage {
      crossOrigin = '';
      decoding = '';
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(val: string) {
        requestedUrls.push(val);
        if (val.startsWith('https://')) {
          this.onerror?.();
        } else if (val.startsWith('/api/cover-proxy?url=')) {
          this.complete = true;
          this.naturalWidth = 512;
          this.naturalHeight = 512;
          this.onload?.();
        }
      }
    }
    globalThis.Image = ProxyFallbackImage as unknown as typeof Image;

    try {
      prefetchInkCoverImage('https://i.ytimg.com/vi/test123/maxresdefault.jpg');
      expect(requestedUrls[0]).toBe('https://i.ytimg.com/vi/test123/maxresdefault.jpg');
      expect(requestedUrls[1]).toBe(
        '/api/cover-proxy?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2Ftest123%2Fmaxresdefault.jpg'
      );
    } finally {
      globalThis.Image = OrigImage;
    }
  });

  it('restores MobileFluidBackdropCanvas dimensions cleanly across effect remounts (React StrictMode / toggle safety)', () => {
    const { rerender } = render(
      <MobileFluidBackdropCanvas
        desktopMode
        coverUrl="https://example.com/a.jpg"
        crossfadeMs={950}
        crossfadeLinear={false}
        ambientMotionEnabled
        reducedMotionPref={false}
      />
    );
    const canvas = screen.getByTestId('live-backdrop-img') as HTMLCanvasElement;
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(144);

    // Toggling ambientMotionEnabled triggers effect cleanup (canvas.width = 0) followed by re-init;
    // dimensions MUST be restored to 240x144 (never stuck at 0x0!)
    rerender(
      <MobileFluidBackdropCanvas
        desktopMode
        coverUrl="https://example.com/a.jpg"
        crossfadeMs={950}
        crossfadeLinear={false}
        ambientMotionEnabled={false}
        reducedMotionPref={false}
      />
    );
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(144);
  });

  it('toggles pm-np-canvas-open on :root only for canvas backdrops, removes hidden radial-gradient behind WebGL canvas, and avoids 1Hz re-renders on positionSec ticks', () => {
    const t1 = makeTrack(1);
    const t2 = makeTrack(2);
    act(() => {
      usePMusicStore.setState({
        nowPlayingOpen: true,
        nowPlayingTab: 'Portada',
        nowPlayingBackdropStyle: 'fluid',
        currentTrack: t1,
        queue: [t1, t2],
        queueIndex: 0,
        positionSec: 15,
        durationSec: 210,
      });
    });

    render(<NowPlayingSheet />);
    expect(document.documentElement.classList.contains('pm-np-canvas-open')).toBe(true);
    const bdContainer = screen.getByTestId('live-backdrop-container');
    expect(bdContainer.style.background).not.toContain('radial-gradient');

    // Switching to minimal backdrop removes pm-np-canvas-open and restores minimal radial-gradient
    act(() => {
      usePMusicStore.setState({ nowPlayingBackdropStyle: 'minimal' });
    });
    expect(document.documentElement.classList.contains('pm-np-canvas-open')).toBe(false);
    expect(bdContainer.style.background).toContain('radial-gradient');

    // TrackListRow does NOT re-render on 1Hz positionSec ticks
    let rowRenderCount = 0;
    const TrackRowProbe: React.FC = () => {
      rowRenderCount++;
      return <TrackListRow track={t2} index={1} />;
    };
    render(<TrackRowProbe />);
    const initialRenders = rowRenderCount;
    for (let s = 16; s <= 25; s++) {
      act(() => {
        usePMusicStore.setState({ positionSec: s });
      });
    }
    expect(rowRenderCount).toBe(initialRenders);
  });

  it('interpolates ambient palette on-demand without extra RAF loops or per-frame array allocations and uses hardware-textured noise in exotic shaders', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    animateAmbientPaletteFromCover({ ...makeTrack(9), thumbnailUrl: '', thumbnailHighUrl: '' }, 1200);
    expect(rafSpy).not.toHaveBeenCalled();

    // Zero-alloc ref readers return stable tuple references
    expect(getLiveAmbientRgbRef()).toBe(getLiveAmbientRgbRef());
    expect(getLiveAmbientQuadRef()).toBe(getLiveAmbientQuadRef());

    // Verify shaders use zero procedural sin() noise loops in hot per-frame fragments
    const inkSrc = readFileSync(
      resolve(__dirname, '../components/InkBleedCoverTransition.tsx'),
      'utf-8'
    );
    const compShader = inkSrc.split('INK_COMPOSITE_FRAGMENT_SRC')[1] ?? '';
    expect(compShader).toContain('u_texField');
    expect(compShader).not.toContain('fbm3');
    expect(compShader).not.toContain('sin(');

    const exoticSrc = readFileSync(
      resolve(__dirname, '../components/ExoticBackdropCanvas.tsx'),
      'utf-8'
    );
    expect(exoticSrc).toContain('u_noiseTex');
    expect(exoticSrc).not.toContain('43758.5453123');

    const cssSrc = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf-8');
    expect(cssSrc).toContain('html.pm-np-canvas-open');
    expect(cssSrc).toContain('content-visibility: hidden');
    // Light-surface drop-shadow suppression must target child utility classes directly, not only ancestor inheritance
    expect(cssSrc).toContain('.pm-np-light-surface [class*="drop-shadow"]');
    // Classic active sing word must NOT trigger per-frame Gaussian drop-shadow filter repaints
    const activeSingBlock =
      cssSrc.split(".pm-sing-word[data-word-state='active']")[1]?.split('}')[0] ?? '';
    expect(activeSingBlock).not.toContain('drop-shadow');
  });

  it('uploads CORS cover textures to WebGL MobileFluidBackdropCanvas even when cover was prebaked before mount, and deduplicates shared CORS fetches', () => {
    const { mockGl, uniform1fCalls } = createMockWebGLContext();
    const mock2d = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(24 * 24 * 4).fill(200) })),
      imageSmoothingEnabled: true,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => {
      if (kind === 'webgl' || kind === 'experimental-webgl') {
        return mockGl as unknown as WebGLRenderingContext;
      }
      if (kind === '2d') {
        return mock2d as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    const requestedUrls: string[] = [];
    const OrigImage = globalThis.Image;
    class CountingCorsImage {
      crossOrigin = '';
      decoding = '';
      complete = true;
      naturalWidth = 512;
      naturalHeight = 512;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      set src(val: string) {
        this._src = val;
        requestedUrls.push(val);
        this.onload?.();
      }
      get src() {
        return this._src;
      }
    }
    globalThis.Image = CountingCorsImage as unknown as typeof Image;

    try {
      // Simulate prior non-CORS prebake before MobileFluidBackdropCanvas mounts
      const coverUrl = 'https://example.com/prebaked-before-mount.jpg';
      const preImg = new Image();
      preImg.src = coverUrl;
      prebakeMobileBackdrop(coverUrl, preImg);
      requestedUrls.length = 0;

      render(
        <MobileFluidBackdropCanvas
          desktopMode
          coverUrl={coverUrl}
          crossfadeMs={950}
          crossfadeLinear={false}
          ambientMotionEnabled={false}
          reducedMotionPref={false}
        />
      );

      // WebGL MUST have initialized first, loaded CORS cover, and uploaded u_hasCurr = 1!
      const hasCurrVals = uniform1fCalls
        .filter((c) => (c.loc as { name?: string })?.name === 'u_hasCurr')
        .map((c) => c.val);
      expect(hasCurrVals[hasCurrVals.length - 1]).toBe(1);
      expect(requestedUrls).toHaveLength(1);

      // Deduplication: subsequent prefetches for the same URL across ink-bleed, fluid & palette hit cache (0 new requests!)
      prefetchInkCoverImage(coverUrl);
      prefetchFluidBackdropCover(coverUrl);
      prefetchAmbientPaletteFromCover(coverUrl);
      expect(requestedUrls).toHaveLength(1);
    } finally {
      globalThis.Image = OrigImage;
    }
  });

  it('recovers pooled WebGL InkBleedCoverTransition cleanly after transient WebGL failure or context loss', () => {
    const { mockGl } = createMockWebGLContext();
    let failGl = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind: string) => {
      if (kind === 'webgl' || kind === 'experimental-webgl') {
        return failGl ? null : (mockGl as unknown as WebGLRenderingContext);
      }
      return null;
    });

    const OrigImage = globalThis.Image;
    class InstantImg {
      crossOrigin = '';
      decoding = '';
      complete = true;
      naturalWidth = 512;
      naturalHeight = 512;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        this.onload?.();
      }
    }
    globalThis.Image = InstantImg as unknown as typeof Image;

    try {
      // Transient WebGL failure during warm-up must NOT permanently brick WebGL for the session
      warmUpInkBleedWebGL();
      failGl = false;

      render(
        <InkBleedCoverTransition
          outgoingUrl="https://example.com/recover-a.jpg"
          outgoingTitle="A"
          incomingUrl="https://example.com/recover-b.jpg"
          incomingTitle="B"
          seedKey="rec:1"
          durationSec={1.5}
        />
      );
      const wrap = screen.getByTestId('ink-bleed-cover');
      const activeCanvas = Array.from(wrap.querySelectorAll('canvas')).find(
        (c) => c.style.display !== 'none'
      );
      expect(activeCanvas?.style.opacity).toBe('1');
    } finally {
      globalThis.Image = OrigImage;
    }
  });
});
