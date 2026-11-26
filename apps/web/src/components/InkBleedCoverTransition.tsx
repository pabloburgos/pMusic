import React, { useEffect, useRef } from 'react';

interface InkBleedCoverTransitionProps {
  outgoingUrl: string;
  outgoingTitle: string;
  incomingUrl: string;
  incomingTitle: string;
  seedKey: string;
  durationSec: number;
}

const MAX_PREFETCH_CACHE = 12;
const inkCoverImageCache = new Map<string, HTMLImageElement>();

/**
 * Prefetches cover artwork with CORS enabled so WebGL ink-bleed crossfades
 * start cleanly at t=0 without waiting on network or image decode.
 */
export function prefetchInkCoverImage(url?: string | null): void {
  const cleanUrl = url?.trim();
  if (!cleanUrl || typeof Image === 'undefined') return;
  const existing = inkCoverImageCache.get(cleanUrl);
  if (existing) {
    // Refresh LRU order
    inkCoverImageCache.delete(cleanUrl);
    inkCoverImageCache.set(cleanUrl, existing);
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (img.naturalWidth <= 0) return;
    inkCoverImageCache.set(cleanUrl, img);
    if (inkCoverImageCache.size > MAX_PREFETCH_CACHE) {
      const oldest = inkCoverImageCache.keys().next().value;
      if (oldest) inkCoverImageCache.delete(oldest);
    }
  };
  img.src = cleanUrl;
}

const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const INK_BLEED_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texOut;
uniform sampler2D u_texIn;
uniform float u_pRaw;
uniform float u_seed;
uniform float u_outAspect;
uniform float u_inAspect;

float hash2D(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 19.37) * 43758.5453123);
}

float quintic(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float valueNoise2D(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float u = quintic(f.x);
  float v = quintic(f.y);
  float a = hash2D(i, seed);
  float b = hash2D(i + vec2(1.0, 0.0), seed);
  float c = hash2D(i + vec2(0.0, 1.0), seed);
  float d = hash2D(i + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

float fbm3(vec2 p, float seed) {
  float o1 = valueNoise2D(p * 3.2, seed);
  float o2 = valueNoise2D(p * 6.8 + vec2(11.4, -7.1), seed + 17.0);
  float o3 = valueNoise2D(p * 13.5 + vec2(-4.7, 19.3), seed + 53.0);
  return o1 * 0.56 + o2 * 0.29 + o3 * 0.15;
}

vec2 coverFitUv(vec2 uv, float aspect, float zoom) {
  vec2 centered = (uv - 0.5) / max(0.001, zoom);
  vec2 aspectScale = vec2(
    aspect > 1.0 ? 1.0 / aspect : 1.0,
    aspect < 1.0 ? aspect : 1.0
  );
  return clamp(centered * aspectScale + 0.5, 0.0, 1.0);
}

void main() {
  float pRaw = clamp(u_pRaw, 0.0, 1.0);
  float p = pRaw * pRaw * (3.0 - 2.0 * pRaw);
  float thr = mix(-0.145, 1.145, p);

  float outScale = 1.0 + 0.015 * p;
  float inScale = 1.028 - 0.028 * p;
  vec3 outCol = texture2D(u_texOut, coverFitUv(v_uv, u_outAspect, outScale)).rgb;
  vec3 inCol = texture2D(u_texIn, coverFitUv(v_uv, u_inAspect, inScale)).rgb;

  if (pRaw <= 0.0 || thr <= -0.145) {
    gl_FragColor = vec4(outCol, 1.0);
    return;
  }

  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 warp = vec2(
    fbm3(uv + vec2(5.2, 1.3), u_seed + 31.0),
    fbm3(uv + vec2(1.7, 9.2), u_seed + 89.0)
  );
  float h = fbm3(uv + 0.65 * warp, u_seed + 149.0);
  float field = clamp((h - 0.18) / 0.64, 0.0, 1.0);

  float d = (field - thr) / 0.145;
  float s = clamp(d, 0.0, 1.0);
  float maskA = s * s * (3.0 - 2.0 * s);

  float outAlpha = pRaw > 0.94 ? clamp((1.0 - pRaw) / 0.06, 0.0, 1.0) : 1.0;
  float rimPeak = sin(3.14159265 * pRaw) * 0.42;
  float rim = (d > 0.0 && d < 1.0) ? clamp(sin(d * 3.14159265) * rimPeak, 0.0, 1.0) : 0.0;

  vec3 outWet = mix(outCol, vec3(0.039, 0.024, 0.024), rim);
  vec3 col = mix(inCol, outWet, maskA * outAlpha);
  gl_FragColor = vec4(col, 1.0);
}
`;

function computeSeedNumber(seedKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seedKey.length; i++) {
    hash ^= seedKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 940) + 17;
}

function loadCorsImage(
  url: string,
  onLoaded: (img: HTMLImageElement) => void,
  onFailed: () => void
): () => void {
  if (!url || typeof Image === 'undefined') {
    onFailed();
    return () => {};
  }
  const cached = inkCoverImageCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    onLoaded(cached);
    return () => {};
  }

  let cancelled = false;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (cancelled) return;
    if (img.naturalWidth > 0) {
      inkCoverImageCache.set(url, img);
      if (inkCoverImageCache.size > MAX_PREFETCH_CACHE) {
        const oldest = inkCoverImageCache.keys().next().value;
        if (oldest) inkCoverImageCache.delete(oldest);
      }
      onLoaded(img);
    } else {
      onFailed();
    }
  };
  img.onerror = () => {
    if (!cancelled) onFailed();
  };
  img.src = url;
  if (img.complete && img.naturalWidth > 0) {
    inkCoverImageCache.set(url, img);
    onLoaded(img);
  }
  return () => {
    cancelled = true;
  };
}

/**
 * 100% GPU WebGL fractal ink-bleed cover crossfade transition.
 * Renders the domain-warped organic fBm ink dissolve in fragment shaders at native 60/120fps
 * with zero CPU per-frame work, falling back cleanly to pure CSS opacity+transform when
 * WebGL/CORS is unavailable.
 */
export const InkBleedCoverTransition: React.FC<InkBleedCoverTransitionProps> = ({
  outgoingUrl,
  outgoingTitle,
  incomingUrl,
  incomingTitle,
  seedKey,
  durationSec,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const incomingImgRef = useRef<HTMLImageElement | null>(null);
  const fallbackOutgoingRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let rafA = 0;
    let rafB = 0;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const totalMs = Math.max(900, Math.round(durationSec * 1000));
    const seedNum = computeSeedNumber(seedKey);
    const inEl = incomingImgRef.current;
    const outEl = fallbackOutgoingRef.current;
    const canvas = canvasRef.current;

    const resetFallbackStyles = () => {
      if (inEl) {
        inEl.style.transition = 'none';
        inEl.style.transform = 'translate3d(0, 0, 0) scale(1.035)';
        inEl.style.opacity = '1';
      }
      if (outEl) {
        outEl.style.transition = 'none';
        outEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
        outEl.style.opacity = '1';
      }
    };
    resetFallbackStyles();

    // GPU CSS fallback when WebGL or CORS upload is unavailable
    let cssFallbackStarted = false;
    const startCssFallback = () => {
      if (cancelled || cssFallbackStarted) return;
      cssFallbackStarted = true;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      const runAnim = () => {
        if (cancelled) return;
        if (inEl) {
          inEl.style.transition = `transform ${totalMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          inEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
        }
        if (outEl) {
          outEl.style.transition = `opacity ${totalMs}ms cubic-bezier(0.37, 0, 0.63, 1), transform ${totalMs}ms cubic-bezier(0.37, 0, 0.63, 1)`;
          outEl.style.opacity = '0';
          outEl.style.transform = 'translate3d(0, 0, 0) scale(0.985)';
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        rafA = requestAnimationFrame(() => {
          rafB = requestAnimationFrame(runAnim);
        });
      } else {
        runAnim();
      }
    };

    const triggerCssFallbackAfterDecode = () => {
      if (typeof Image !== 'undefined' && incomingUrl) {
        const pre = new Image();
        pre.decoding = 'async';
        safetyTimer = setTimeout(startCssFallback, 450);
        const go = () => {
          if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
          }
          if (typeof pre.decode === 'function') {
            void pre.decode().catch(() => {}).finally(startCssFallback);
          } else {
            startCssFallback();
          }
        };
        pre.onload = go;
        pre.onerror = startCssFallback;
        pre.src = incomingUrl;
        if (pre.complete && pre.naturalWidth > 0) go();
      } else {
        startCssFallback();
      }
    };

    // Attempt 100% GPU WebGL ink-bleed shader compositor
    let gl: WebGLRenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let buf: WebGLBuffer | null = null;
    let texOut: WebGLTexture | null = null;
    let texIn: WebGLTexture | null = null;
    let uTexOut: WebGLUniformLocation | null = null;
    let uTexIn: WebGLUniformLocation | null = null;
    let uPRaw: WebGLUniformLocation | null = null;
    let uSeed: WebGLUniformLocation | null = null;
    let uOutAspect: WebGLUniformLocation | null = null;
    let uInAspect: WebGLUniformLocation | null = null;

    if (canvas) {
      try {
        const rectW = containerRef.current?.getBoundingClientRect().width || 0;
        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
        const side = rectW > 0 ? Math.min(512, Math.max(256, Math.round(rectW * dpr))) : 512;
        canvas.width = side;
        canvas.height = side;

        gl =
          (canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            depth: false,
            preserveDrawingBuffer: false,
          }) as WebGLRenderingContext | null) ??
          (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

        if (gl) {
          vs = gl.createShader(gl.VERTEX_SHADER);
          fs = gl.createShader(gl.FRAGMENT_SHADER);
          prog = gl.createProgram();
          if (vs && fs && prog) {
            gl.shaderSource(vs, VERTEX_SRC);
            gl.compileShader(vs);
            gl.shaderSource(fs, INK_BLEED_FRAGMENT_SRC);
            gl.compileShader(fs);
            if (
              gl.getShaderParameter(vs, gl.COMPILE_STATUS) &&
              gl.getShaderParameter(fs, gl.COMPILE_STATUS)
            ) {
              gl.attachShader(prog, vs);
              gl.attachShader(prog, fs);
              gl.linkProgram(prog);
              if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(
                  gl.ARRAY_BUFFER,
                  new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
                  gl.STATIC_DRAW
                );
                const loc = gl.getAttribLocation(prog, 'a_pos');
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

                const createCoverTex = (): WebGLTexture | null => {
                  if (!gl) return null;
                  const tex = gl.createTexture();
                  if (!tex) return null;
                  gl.bindTexture(gl.TEXTURE_2D, tex);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                  return tex;
                };

                texOut = createCoverTex();
                texIn = createCoverTex();
                uTexOut = gl.getUniformLocation(prog, 'u_texOut');
                uTexIn = gl.getUniformLocation(prog, 'u_texIn');
                uPRaw = gl.getUniformLocation(prog, 'u_pRaw');
                uSeed = gl.getUniformLocation(prog, 'u_seed');
                uOutAspect = gl.getUniformLocation(prog, 'u_outAspect');
                uInAspect = gl.getUniformLocation(prog, 'u_inAspect');
              } else {
                gl = null;
              }
            } else {
              gl = null;
            }
          } else {
            gl = null;
          }
        }
      } catch {
        gl = null;
      }
    }

    if (!gl || !prog || !texOut || !texIn) {
      triggerCssFallbackAfterDecode();
      return () => {
        cancelled = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (rafA && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafA);
        if (rafB && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafB);
      };
    }

    let outAspect = 1;
    let inAspect = 1;
    let outUploaded = false;
    let inUploaded = false;
    let webglStarted = false;
    let fellBack = false;
    let hidFallback = false;

    const uploadImg = (tex: WebGLTexture, img: HTMLImageElement): boolean => {
      if (!gl || cancelled) return false;
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        return true;
      } catch {
        return false;
      }
    };

    const cleanupWebGL = () => {
      if (gl) {
        try {
          if (texOut) gl.deleteTexture(texOut);
          if (texIn) gl.deleteTexture(texIn);
          if (buf) gl.deleteBuffer(buf);
          if (vs) gl.deleteShader(vs);
          if (fs) gl.deleteShader(fs);
          if (prog) gl.deleteProgram(prog);
        } catch {
          // ignore WebGL teardown errors
        }
      }
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };

    const failToCssFallback = () => {
      if (cancelled || fellBack || webglStarted) return;
      fellBack = true;
      if (canvas) {
        canvas.style.opacity = '0';
      }
      triggerCssFallbackAfterDecode();
    };

    const maybeStartWebGL = () => {
      if (cancelled || fellBack || webglStarted || !outUploaded || !inUploaded || !gl || !prog || !canvas) {
        return;
      }
      webglStarted = true;
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }

      const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      if (uSeed) gl.uniform1f(uSeed, seedNum);
      if (uOutAspect) gl.uniform1f(uOutAspect, outAspect);
      if (uInAspect) gl.uniform1f(uInAspect, inAspect);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texOut);
      if (uTexOut) gl.uniform1i(uTexOut, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texIn);
      if (uTexIn) gl.uniform1i(uTexIn, 1);

      const renderFrame = (now: number) => {
        if (cancelled || !gl) return;
        const pRaw = Math.max(0, Math.min(1, (now - startMs) / totalMs));
        if (uPRaw) gl.uniform1f(uPRaw, pRaw);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (!hidFallback) {
          hidFallback = true;
          canvas.style.opacity = '1';
          if (outEl) outEl.style.opacity = '0';
          if (inEl) inEl.style.opacity = '0';
        }

        if (pRaw < 1 && typeof requestAnimationFrame === 'function') {
          rafId = requestAnimationFrame(renderFrame);
        }
      };

      renderFrame(startMs);
    };

    // Guard if CORS image takes too long -> smoothly trigger CSS GPU transition instead of stalling
    safetyTimer = setTimeout(failToCssFallback, 500);

    const cancelOutLoad = loadCorsImage(
      outgoingUrl,
      (img) => {
        if (cancelled || fellBack) return;
        outAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        if (uploadImg(texOut!, img)) {
          outUploaded = true;
          maybeStartWebGL();
        } else {
          failToCssFallback();
        }
      },
      failToCssFallback
    );

    const cancelInLoad = loadCorsImage(
      incomingUrl,
      (img) => {
        if (cancelled || fellBack) return;
        inAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        if (uploadImg(texIn!, img)) {
          inUploaded = true;
          maybeStartWebGL();
        } else {
          failToCssFallback();
        }
      },
      failToCssFallback
    );

    return () => {
      cancelled = true;
      cancelOutLoad();
      cancelInLoad();
      if (safetyTimer) clearTimeout(safetyTimer);
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      if (rafA && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafA);
      if (rafB && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafB);
      cleanupWebGL();
    };
  }, [durationSec, incomingUrl, outgoingUrl, seedKey]);

  return (
    <div
      ref={containerRef}
      data-testid="ink-bleed-cover"
      className="relative h-full w-full overflow-hidden rounded-[16px]"
    >
      <img
        ref={incomingImgRef}
        src={incomingUrl}
        alt={incomingTitle}
        loading="eager"
        decoding="async"
        draggable={false}
        className="h-full w-full select-none object-cover will-change-transform"
        style={{
          transform: 'translate3d(0, 0, 0) scale(1.035)',
          opacity: 1,
        }}
      />

      <img
        ref={fallbackOutgoingRef}
        src={outgoingUrl}
        alt={outgoingTitle}
        aria-hidden="true"
        loading="eager"
        decoding="async"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover will-change-[opacity,transform]"
        style={{
          transform: 'translate3d(0, 0, 0) scale(1)',
          opacity: 1,
        }}
      />

      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full will-change-transform"
        style={{ opacity: 0 }}
      />
    </div>
  );
};
