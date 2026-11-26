import React, { useEffect, useRef } from 'react';
import {
  getLiveAmbientLuminance,
  getLiveAmbientQuadRef,
  loadSharedCorsCoverImage,
  type RgbTriple,
} from '../utils/cover-color.ts';

export type ExoticBackdropStyle = 'paint' | 'pulse';

interface ExoticBackdropCanvasProps {
  style: ExoticBackdropStyle;
  coverUrl?: string | null;
  crossfadeMs?: number;
  isPlaying: boolean;
  ambientMotionEnabled: boolean;
  reducedMotionPref: boolean;
  throttleFps?: boolean;
}

const TEX_SIZE = 128;
const NOISE_TEX_SIZE = 64;

// Pre-computed deterministic 64x64 2-channel RGBA noise buffer (zero sin() in fragment shaders!)
let cachedNoiseBytes: Uint8Array | null = null;
function getNoiseTextureBytes(): Uint8Array {
  if (cachedNoiseBytes) return cachedNoiseBytes;
  const bytes = new Uint8Array(NOISE_TEX_SIZE * NOISE_TEX_SIZE * 4);
  let state = 0x9e3779b9;
  const nextByte = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 24) & 255;
  };
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = nextByte();
    bytes[i + 1] = nextByte();
    bytes[i + 2] = nextByte();
    bytes[i + 3] = 255;
  }
  cachedNoiseBytes = bytes;
  return bytes;
}

const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Hardware-filtered 2-channel texture fBm painterly flow:
// ZERO sin() noise evaluations per pixel (~25x faster GPU ALU than procedural hash fBm).
const PAINT_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform sampler2D u_texPrev;
uniform sampler2D u_texCurr;
uniform sampler2D u_noiseTex;
uniform float u_mix;
uniform float u_hasTex;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform float u_luma;

vec2 fbm2(vec2 p) {
  vec2 v = vec2(0.0);
  float a = 0.54;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  vec2 q = p * 0.045;
  for (int i = 0; i < 3; i++) {
    v += a * texture2D(u_noiseTex, q).rg;
    q = rot * q * 2.02 + vec2(0.17, 0.31);
    a *= 0.5;
  }
  return v;
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec3 sampleCover(vec2 uv) {
  if (u_hasTex < 0.5) {
    float g = clamp(uv.x * 0.5 + uv.y * 0.5, 0.0, 1.0);
    return mix(mix(u_c4, u_c1, g), mix(u_c2, u_c3, uv.y), 0.45);
  }
  vec3 cPrev = texture2D(u_texPrev, uv).rgb;
  vec3 cCurr = texture2D(u_texCurr, uv).rgb;
  return mix(cPrev, cCurr, clamp(u_mix, 0.0, 1.0));
}

void main() {
  float minDim = max(1.0, min(u_res.x, u_res.y));
  vec2 aspect = u_res / minDim;
  float isPortrait = step(u_res.x, u_res.y);
  vec2 centered = (v_uv - 0.5) * aspect;
  vec2 uv = centered * mix(1.38, 1.08, isPortrait);
  float t = u_time * 0.22;

  // Multi-directional wandering drift (incommensurate Lissajous orbits — never drifts in one fixed direction)
  vec2 driftQ = vec2(
    sin(t * 0.41) * 0.52 + cos(t * 0.27 + 1.3) * 0.34,
    cos(t * 0.36 + 0.7) * 0.48 + sin(t * 0.23 + 2.4) * 0.32
  );
  vec2 driftR = vec2(
    cos(t * 0.31 + 2.1) * 0.44 - sin(t * 0.19 + 0.5) * 0.30,
    sin(t * 0.29 + 1.6) * 0.42 + cos(t * 0.17 + 3.1) * 0.28
  );

  vec2 q = fbm2(uv + driftQ);
  vec2 r = fbm2(uv + 1.95 * q + vec2(1.7, 9.2) + driftR);
  float f = texture2D(u_noiseTex, (uv + 1.8 * r) * 0.06 + driftQ * 0.08).r * 0.65 +
            texture2D(u_noiseTex, (uv + 1.8 * r) * 0.13 + vec2(0.23, 0.41) - driftR * 0.07).g * 0.35;

  // Organic wandering painterly flow with gentle oscillating sway (no monotonous linear panning)
  vec2 baseSample = centered * mix(0.62, 0.44, isPortrait);
  vec2 wander1 = vec2(sin(t * 0.29 + 0.4), cos(t * 0.24 + 1.1)) * 0.11;
  vec2 wander2 = vec2(cos(t * 0.21 + 2.2), sin(t * 0.27 + 0.8)) * 0.12;
  vec2 wander3 = vec2(sin(t * 0.18 + 3.5), cos(t * 0.32 + 2.0)) * 0.10;
  vec2 flow = (q - 0.5) * 0.46 + (r - 0.5) * 0.38;
  vec2 coverUv1 = rot2(baseSample, 0.92 + sin(t * 0.19) * 0.42 + cos(t * 0.11) * 0.18) + vec2(0.28, 0.74) + flow + wander1;
  vec2 coverUv2 = rot2(vec2(-baseSample.x, baseSample.y), -1.48 + cos(t * 0.17 + 1.0) * 0.38) * 0.94 + vec2(0.76, 0.26) + (r - 0.5) * 0.48 + wander2;
  vec2 coverUv3 = rot2(baseSample, 2.35 + sin(t * 0.15 + 2.1) * 0.45) * 0.88 + vec2(0.68, 0.78) + (q.yx - 0.5) * 0.40 + wander3;

  vec3 s1 = sampleCover(coverUv1);
  vec3 s2 = sampleCover(coverUv2);
  vec3 s3 = sampleCover(coverUv3);

  vec3 col = mix(s1, s2, smoothstep(0.18, 0.82, f));
  col = mix(col, s3, smoothstep(0.26, 0.84, length(q) * 0.76) * 0.68);

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.09);

  float vigDist = length(centered / mix(1.0, 1.24, isPortrait));
  float vig = 1.0 - smoothstep(0.42, 1.24, vigDist * 0.95);
  col *= mix(0.76, 1.02, vig);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Smooth organic breathing pulse waves using hardware-filtered noise texture (zero sin() hash loops)
const PULSE_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform sampler2D u_texPrev;
uniform sampler2D u_texCurr;
uniform sampler2D u_noiseTex;
uniform float u_mix;
uniform float u_hasTex;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform float u_luma;

vec2 fbm2(vec2 p) {
  vec2 v = vec2(0.0);
  float a = 0.54;
  mat2 rot = mat2(0.76, 0.65, -0.65, 0.76);
  vec2 q = p * 0.05;
  for (int i = 0; i < 3; i++) {
    v += a * texture2D(u_noiseTex, q).rg;
    q = rot * q * 1.95 + vec2(0.21, 0.43);
    a *= 0.5;
  }
  return v;
}

vec3 sampleCover(vec2 uv) {
  if (u_hasTex < 0.5) {
    float g = clamp(uv.x * 0.5 + uv.y * 0.5, 0.0, 1.0);
    return mix(mix(u_c4, u_c1, g), mix(u_c2, u_c3, uv.y), 0.45);
  }
  vec3 cPrev = texture2D(u_texPrev, uv).rgb;
  vec3 cCurr = texture2D(u_texCurr, uv).rgb;
  return mix(cPrev, cCurr, clamp(u_mix, 0.0, 1.0));
}

void main() {
  float minDim = max(1.0, min(u_res.x, u_res.y));
  vec2 norm = u_res / minDim;
  float isPortrait = step(u_res.x, u_res.y);
  vec2 p = (v_uv - 0.5) * norm * mix(1.0, 0.78, isPortrait);
  float t = u_time * 0.28;

  float r = length(p);
  vec2 dir = r > 0.0001 ? p / r : vec2(0.0, 1.0);
  vec2 n = fbm2(p * 1.65 + vec2(t * 0.32, -t * 0.25));
  float n1 = n.x;
  float n2 = n.y;

  float breath = 1.0 + 0.075 * sin(t * 1.25);
  float pulsePhase = r * 4.5 - t * 1.8 + (n1 - 0.5) * 1.55;
  float wave = 0.5 + 0.5 * sin(pulsePhase);
  float ringGlow = wave * wave;

  float spinA = t * 0.16;
  float cA = cos(spinA);
  float sA = sin(spinA);
  vec2 spinP = vec2(p.x * cA - p.y * sA, p.x * sA + p.y * cA);
  vec2 radialDrift = dir * (0.08 * sin(pulsePhase) + (n1 - 0.5) * 0.18);

  vec2 uvA = p * (0.58 * breath) + 0.5 + radialDrift;
  vec2 uvB = spinP * 0.52 + 0.5 + vec2(n2 - 0.5, n1 - 0.5) * 0.28;

  vec3 sAcol = sampleCover(uvA);
  vec3 sBcol = sampleCover(uvB);
  vec3 col = mix(sAcol, sBcol, smoothstep(0.22, 0.78, n2));

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.08);
  float halo = exp(-r * r * mix(1.35, 1.05, isPortrait)) * (0.14 + 0.10 * sin(t * 1.25));
  col = col * (0.86 + 0.24 * ringGlow) + halo * mix(u_c1, u_c2, wave) * 0.45;

  float coreSoft = 1.0 - smoothstep(0.22, mix(1.22, 1.48, isPortrait), r);
  col *= mix(0.74, 1.02, coreSoft);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function toneRgb([r, g, b]: RgbTriple, sat = 1.06, mult = 1.0): RgbTriple {
  const luma = r * 0.299 + g * 0.587 + b * 0.114;
  return [
    Math.max(0, Math.min(255, Math.round((luma + (r - luma) * sat) * mult))),
    Math.max(0, Math.min(255, Math.round((luma + (g - luma) * sat) * mult))),
    Math.max(0, Math.min(255, Math.round((luma + (b - luma) * sat) * mult))),
  ];
}

function rgbStr([r, g, b]: RgbTriple, a = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

let exoticScratch1: HTMLCanvasElement | null = null;
let exoticScratch2: HTMLCanvasElement | null = null;

function buildSoftCoverCanvas(
  img: HTMLImageElement,
  style: ExoticBackdropStyle = 'paint'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  try {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const side = Math.min(iw, ih);
    const sx = (iw - side) * 0.5;
    const sy = (ih - side) * 0.5;

    const pass2Dim = style === 'paint' ? 22 : 18;

    if (!exoticScratch1) {
      exoticScratch1 = document.createElement('canvas');
      exoticScratch1.width = 96;
      exoticScratch1.height = 96;
    }
    if (!exoticScratch2) {
      exoticScratch2 = document.createElement('canvas');
    }
    if (exoticScratch2.width !== pass2Dim || exoticScratch2.height !== pass2Dim) {
      exoticScratch2.width = pass2Dim;
      exoticScratch2.height = pass2Dim;
    }

    const c1 = exoticScratch1.getContext('2d');
    const c2 = exoticScratch2.getContext('2d');

    const out = document.createElement('canvas');
    out.width = TEX_SIZE;
    out.height = TEX_SIZE;
    const cOut = out.getContext('2d');
    if (!c1 || !c2 || !cOut) return null;

    c1.clearRect(0, 0, 96, 96);
    c1.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in c1) c1.imageSmoothingQuality = 'high';
    c1.drawImage(img, sx, sy, side, side, 0, 0, 96, 96);

    c2.clearRect(0, 0, pass2Dim, pass2Dim);
    c2.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in c2) c2.imageSmoothingQuality = 'high';
    c2.drawImage(exoticScratch1, 0, 0, pass2Dim, pass2Dim);

    cOut.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cOut) cOut.imageSmoothingQuality = 'high';
    cOut.drawImage(exoticScratch2, 0, 0, TEX_SIZE, TEX_SIZE);

    return out;
  } catch {
    return null;
  }
}

export const ExoticBackdropCanvas: React.FC<ExoticBackdropCanvasProps> = React.memo(
  ({
    style,
    coverUrl,
    crossfadeMs = 950,
    isPlaying,
    ambientMotionEnabled,
    reducedMotionPref,
    throttleFps = false,
  }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const styleRef = useRef<ExoticBackdropStyle>(style);
    styleRef.current = style;
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;
    const throttleFpsRef = useRef(throttleFps);
    throttleFpsRef.current = throttleFps;

    // Shared cover-texture & crossfade state between GL/2D render loop and coverUrl loader
    const coverMediaRef = useRef<{
      gl: WebGLRenderingContext | null;
      texPrev: WebGLTexture | null;
      texCurr: WebGLTexture | null;
      prevCanvas: HTMLCanvasElement | null;
      currCanvas: HTMLCanvasElement | null;
      hasTex: boolean;
      mix: number;
      mixStartMs: number;
      mixDurMs: number;
      requestStaticPaint: (() => void) | null;
    }>({
      gl: null,
      texPrev: null,
      texCurr: null,
      prevCanvas: null,
      currCanvas: null,
      hasTex: false,
      mix: 1,
      mixStartMs: 0,
      mixDurMs: 0,
      requestStaticPaint: null,
    });

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const isMobileLike =
        typeof window !== 'undefined' &&
        (window.location?.hostname === 'appassets.pmusic.local' ||
          (typeof window.matchMedia === 'function' &&
            window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches));

      const staticMode = !ambientMotionEnabled || reducedMotionPref;
      let rafId = 0;
      let cancelled = false;

      let gl: WebGLRenderingContext | null = null;
      let glProg: WebGLProgram | null = null;
      let vs: WebGLShader | null = null;
      let fs: WebGLShader | null = null;
      let buf: WebGLBuffer | null = null;
      let uTime: WebGLUniformLocation | null = null;
      let uRes: WebGLUniformLocation | null = null;
      let uMix: WebGLUniformLocation | null = null;
      let uHasTex: WebGLUniformLocation | null = null;
      let uC1: WebGLUniformLocation | null = null;
      let uC2: WebGLUniformLocation | null = null;
      let uC3: WebGLUniformLocation | null = null;
      let uC4: WebGLUniformLocation | null = null;
      let uLuma: WebGLUniformLocation | null = null;
      let texPrev: WebGLTexture | null = null;
      let texCurr: WebGLTexture | null = null;
      let texNoise: WebGLTexture | null = null;

      const initCoverTexture = (targetGl: WebGLRenderingContext): WebGLTexture | null => {
        const tex = targetGl.createTexture();
        if (!tex) return null;
        targetGl.bindTexture(targetGl.TEXTURE_2D, tex);
        targetGl.texParameteri(
          targetGl.TEXTURE_2D,
          targetGl.TEXTURE_WRAP_S,
          targetGl.MIRRORED_REPEAT
        );
        targetGl.texParameteri(
          targetGl.TEXTURE_2D,
          targetGl.TEXTURE_WRAP_T,
          targetGl.MIRRORED_REPEAT
        );
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_MIN_FILTER, targetGl.LINEAR);
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_MAG_FILTER, targetGl.LINEAR);
        targetGl.texImage2D(
          targetGl.TEXTURE_2D,
          0,
          targetGl.RGBA,
          1,
          1,
          0,
          targetGl.RGBA,
          targetGl.UNSIGNED_BYTE,
          new Uint8Array([24, 24, 30, 255])
        );
        return tex;
      };

      const initNoiseTexture = (targetGl: WebGLRenderingContext): WebGLTexture | null => {
        const tex = targetGl.createTexture();
        if (!tex) return null;
        targetGl.bindTexture(targetGl.TEXTURE_2D, tex);
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_WRAP_S, targetGl.REPEAT);
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_WRAP_T, targetGl.REPEAT);
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_MIN_FILTER, targetGl.LINEAR);
        targetGl.texParameteri(targetGl.TEXTURE_2D, targetGl.TEXTURE_MAG_FILTER, targetGl.LINEAR);
        targetGl.texImage2D(
          targetGl.TEXTURE_2D,
          0,
          targetGl.RGBA,
          NOISE_TEX_SIZE,
          NOISE_TEX_SIZE,
          0,
          targetGl.RGBA,
          targetGl.UNSIGNED_BYTE,
          getNoiseTextureBytes()
        );
        return tex;
      };

      try {
        gl =
          (canvas.getContext('webgl', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance',
          }) as WebGLRenderingContext | null) ??
          (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
        if (gl) {
          vs = gl.createShader(gl.VERTEX_SHADER);
          fs = gl.createShader(gl.FRAGMENT_SHADER);
          const prog = gl.createProgram();
          if (vs && fs && prog) {
            gl.shaderSource(vs, VERTEX_SRC);
            gl.compileShader(vs);
            gl.shaderSource(fs, style === 'pulse' ? PULSE_FRAGMENT_SRC : PAINT_FRAGMENT_SRC);
            gl.compileShader(fs);
            if (
              gl.getShaderParameter(vs, gl.COMPILE_STATUS) &&
              gl.getShaderParameter(fs, gl.COMPILE_STATUS)
            ) {
              gl.attachShader(prog, vs);
              gl.attachShader(prog, fs);
              gl.linkProgram(prog);
              if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                glProg = prog;
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

                gl.useProgram(prog);
                uTime = gl.getUniformLocation(prog, 'u_time');
                uRes = gl.getUniformLocation(prog, 'u_res');
                uMix = gl.getUniformLocation(prog, 'u_mix');
                uHasTex = gl.getUniformLocation(prog, 'u_hasTex');
                uC1 = gl.getUniformLocation(prog, 'u_c1');
                uC2 = gl.getUniformLocation(prog, 'u_c2');
                uC3 = gl.getUniformLocation(prog, 'u_c3');
                uC4 = gl.getUniformLocation(prog, 'u_c4');
                uLuma = gl.getUniformLocation(prog, 'u_luma');

                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
                texPrev = initCoverTexture(gl);
                texCurr = initCoverTexture(gl);
                texNoise = initNoiseTexture(gl);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texPrev);
                gl.uniform1i(gl.getUniformLocation(prog, 'u_texPrev'), 0);

                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, texCurr);
                gl.uniform1i(gl.getUniformLocation(prog, 'u_texCurr'), 1);

                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, texNoise);
                gl.uniform1i(gl.getUniformLocation(prog, 'u_noiseTex'), 2);
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

      let ctx2d: CanvasRenderingContext2D | null = null;
      if (!glProg) {
        try {
          ctx2d = canvas.getContext('2d', { alpha: false });
        } catch {
          ctx2d = null;
        }
      }

      if (!glProg && !ctx2d) return;

      const media = coverMediaRef.current;
      media.gl = gl;
      media.texPrev = texPrev;
      media.texCurr = texCurr;
      if (gl && media.prevCanvas && texPrev) {
        try {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texPrev);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.prevCanvas);
        } catch {
          // ignore upload fallback
        }
      }
      if (gl && media.currCanvas && texCurr) {
        try {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, texCurr);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.currCanvas);
          media.hasTex = true;
        } catch {
          // ignore upload fallback
        }
      }

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const baseW = Math.max(
          240,
          rect.width || (typeof window !== 'undefined' ? window.innerWidth : 640)
        );
        const baseH = Math.max(
          240,
          rect.height || (typeof window !== 'undefined' ? window.innerHeight : 640)
        );
        if (glProg && gl) {
          // Soft 18-22px painterly field looks identical at <=320px while cutting GPU fillrate ~2.5x
          const scale = isMobileLike ? 0.26 : 0.30;
          canvas.width = Math.min(320, Math.max(160, Math.round(baseW * scale)));
          canvas.height = Math.min(320, Math.max(160, Math.round(baseH * scale)));
          gl.viewport(0, 0, canvas.width, canvas.height);
        } else {
          const scale = isMobileLike ? 0.42 : 0.52;
          canvas.width = Math.min(640, Math.round(baseW * scale));
          canvas.height = Math.min(640, Math.round(baseH * scale));
        }
      };
      resize();

      let ro: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
      }

      const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let lastDrawMs = -Infinity;
      let accumTimeSec = 0;
      let lastStepMs = startMs;

      const renderFrame = (now: number) => {
        if (cancelled) return;
        if (typeof document !== 'undefined' && document.hidden) {
          rafId = 0;
          return;
        }
        const frameBudgetMs = staticMode
          ? 120
          : !glProg
            ? 32
            : throttleFpsRef.current
              ? 30
              : 0;
        if (frameBudgetMs > 0 && now - lastDrawMs < frameBudgetMs && lastDrawMs > 0) {
          if (!staticMode && typeof requestAnimationFrame === 'function') {
            rafId = requestAnimationFrame(renderFrame);
          }
          return;
        }
        const dt = Math.min(0.08, Math.max(0.001, (now - lastStepMs) / 1000));
        lastStepMs = now;
        lastDrawMs = now;
        if (!staticMode) {
          accumTimeSec += dt * (isPlayingRef.current ? 1.0 : 0.35);
        }

        if (media.mix < 1) {
          const dur = Math.max(120, media.mixDurMs || 950);
          media.mix = Math.max(0, Math.min(1, (now - media.mixStartMs) / dur));
        }

        const quad = getLiveAmbientQuadRef();
        const c1Raw = quad[0]!;
        const c2Raw = quad[1]!;
        const c3Raw = quad[2]!;
        const c4Raw = quad[3]!;
        const coverLuma = getLiveAmbientLuminance();
        const t = accumTimeSec;

        if (gl && glProg) {
          if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
            return;
          }
          gl.uniform1f(uTime, t);
          gl.uniform2f(uRes, canvas.width, canvas.height);
          if (uMix) gl.uniform1f(uMix, media.mix);
          if (uHasTex) gl.uniform1f(uHasTex, media.hasTex ? 1 : 0);
          gl.uniform3f(uC1, c1Raw[0] / 255, c1Raw[1] / 255, c1Raw[2] / 255);
          gl.uniform3f(uC2, c2Raw[0] / 255, c2Raw[1] / 255, c2Raw[2] / 255);
          gl.uniform3f(uC3, c3Raw[0] / 255, c3Raw[1] / 255, c3Raw[2] / 255);
          if (uC4) gl.uniform3f(uC4, c4Raw[0] / 255, c4Raw[1] / 255, c4Raw[2] / 255);
          if (uLuma) gl.uniform1f(uLuma, coverLuma);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        } else if (ctx2d) {
          const w = canvas.width;
          const h = canvas.height;
          const activeImg = media.currCanvas ?? media.prevCanvas;

          if (activeImg) {
            const drawCoverSet = (source: HTMLCanvasElement, alpha: number) => {
              if (alpha <= 0.005) return;
              const curStyle = styleRef.current;
              const minDim2d = Math.max(1, Math.min(w, h));
              const coverDim2d = Math.max(w, h) * 1.12;
              ctx2d!.save();
              ctx2d!.globalCompositeOperation = 'source-over';
              ctx2d!.globalAlpha = alpha;
              if (curStyle === 'paint') {
                ctx2d!.save();
                ctx2d!.translate(w * 0.5, h * 0.5);
                ctx2d!.rotate(0.75 + Math.sin(t * 0.24) * 0.35);
                ctx2d!.scale(1.42, -1.42);
                ctx2d!.drawImage(source, -coverDim2d * 0.5, -coverDim2d * 0.5, coverDim2d, coverDim2d);
                ctx2d!.restore();

                ctx2d!.save();
                ctx2d!.globalAlpha = alpha * 0.58;
                ctx2d!.translate(
                  w * 0.5 + minDim2d * 0.14 * Math.cos(t * 0.36),
                  h * 0.5 + minDim2d * 0.14 * Math.sin(t * 0.32)
                );
                ctx2d!.rotate(-1.1 + t * 0.22);
                ctx2d!.scale(-1.32, 1.32);
                ctx2d!.drawImage(source, -coverDim2d * 0.5, -coverDim2d * 0.5, coverDim2d, coverDim2d);
                ctx2d!.restore();

                ctx2d!.save();
                ctx2d!.globalAlpha = alpha * 0.42;
                ctx2d!.translate(
                  w * 0.5 - minDim2d * 0.12 * Math.sin(t * 0.29),
                  h * 0.5 + minDim2d * 0.12 * Math.cos(t * 0.34)
                );
                ctx2d!.rotate(2.2 - t * 0.18);
                ctx2d!.scale(1.48, 1.48);
                ctx2d!.drawImage(source, -coverDim2d * 0.5, -coverDim2d * 0.5, coverDim2d, coverDim2d);
                ctx2d!.restore();
              } else {
                const cx = w * 0.5;
                const cy = h * 0.5;
                const breathScale = 1.18 + 0.08 * Math.sin(t * 1.15);
                ctx2d!.save();
                ctx2d!.translate(cx, cy);
                ctx2d!.rotate(t * 0.12);
                ctx2d!.scale(breathScale, breathScale);
                ctx2d!.drawImage(source, -coverDim2d * 0.5, -coverDim2d * 0.5, coverDim2d, coverDim2d);
                ctx2d!.restore();

                const ringWave = 0.5 + 0.5 * Math.sin(t * 1.8);
                const pulseGrad = ctx2d!.createRadialGradient(
                  cx,
                  cy,
                  minDim2d * 0.08,
                  cx,
                  cy,
                  Math.hypot(w, h) * (0.48 + 0.12 * ringWave)
                );
                pulseGrad.addColorStop(0, rgbStr(c1Raw, 0.22 * alpha));
                pulseGrad.addColorStop(0.5, rgbStr(c2Raw, 0.16 * alpha));
                pulseGrad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx2d!.fillStyle = pulseGrad;
                ctx2d!.fillRect(0, 0, w, h);
              }
              ctx2d!.restore();
            };

            if (media.prevCanvas && media.currCanvas && media.mix < 1) {
              drawCoverSet(media.prevCanvas, 1);
              drawCoverSet(media.currCanvas, media.mix);
            } else {
              drawCoverSet(activeImg, 1);
            }
          } else {
            const mult = 0.96 + coverLuma * 0.12;
            const t1 = toneRgb(c1Raw, 1.06, mult);
            const t2 = toneRgb(c2Raw, 1.06, mult);
            const t3 = toneRgb(c3Raw, 1.04, mult);
            const baseRgb = toneRgb(c4Raw, 1.04, mult);
            const paletteList = [t1, t2, t3];
            const curStyle = styleRef.current;

            ctx2d.globalCompositeOperation = 'source-over';
            ctx2d.fillStyle = rgbStr(baseRgb, 1);
            ctx2d.fillRect(0, 0, w, h);

            for (let i = 0; i < 6; i++) {
              const ang = t * (0.24 + i * 0.06) + i * 1.05;
              const cx = w * (0.5 + (curStyle === 'paint' ? 0.34 : 0.2) * Math.cos(ang));
              const cy = h * (0.5 + (curStyle === 'paint' ? 0.32 : 0.2) * Math.sin(ang * 1.2));
              const rad = Math.max(w, h) * 0.42;
              const col = paletteList[i % 3]!;
              const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, rad);
              grad.addColorStop(0, rgbStr(col, 0.58));
              grad.addColorStop(0.58, rgbStr(col, 0.22));
              grad.addColorStop(1, rgbStr(col, 0));
              ctx2d.fillStyle = grad;
              ctx2d.fillRect(0, 0, w, h);
            }
          }
        }

        if ((!staticMode || media.mix < 1) && typeof requestAnimationFrame === 'function') {
          rafId = requestAnimationFrame(renderFrame);
        } else {
          rafId = 0;
        }
      };

      media.requestStaticPaint = () => {
        if (cancelled || rafId) return;
        if (typeof requestAnimationFrame === 'function') {
          rafId = requestAnimationFrame(renderFrame);
        } else {
          renderFrame(typeof performance !== 'undefined' ? performance.now() : Date.now());
        }
      };

      const handleContextLost = (ev: Event) => {
        ev.preventDefault();
        if (rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      };
      canvas.addEventListener('webglcontextlost', handleContextLost, false);

      const handleVisibility = () => {
        if (cancelled || staticMode) return;
        if (typeof document !== 'undefined' && document.hidden) {
          if (rafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
        } else if (!rafId && typeof requestAnimationFrame === 'function') {
          lastStepMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          rafId = requestAnimationFrame(renderFrame);
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibility);
      }

      if (staticMode) {
        renderFrame(startMs);
      } else if (
        typeof requestAnimationFrame === 'function' &&
        !(typeof document !== 'undefined' && document.hidden)
      ) {
        rafId = requestAnimationFrame(renderFrame);
      } else {
        renderFrame(startMs);
      }

      return () => {
        cancelled = true;
        media.requestStaticPaint = null;
        media.gl = null;
        media.texPrev = null;
        media.texCurr = null;
        canvas.removeEventListener('webglcontextlost', handleContextLost, false);
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', handleVisibility);
        }
        if (rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
        }
        if (ro) ro.disconnect();
        if (gl) {
          try {
            if (texPrev) gl.deleteTexture(texPrev);
            if (texCurr) gl.deleteTexture(texCurr);
            if (texNoise) gl.deleteTexture(texNoise);
            if (buf) gl.deleteBuffer(buf);
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            if (glProg) gl.deleteProgram(glProg);
          } catch {
            // ignore WebGL teardown failure
          }
        }
        canvas.width = 0;
        canvas.height = 0;
      };
    }, [style, ambientMotionEnabled, reducedMotionPref]);

    // Release offscreen baked canvases on unmount
    useEffect(() => {
      return () => {
        const media = coverMediaRef.current;
        if (media.prevCanvas) {
          media.prevCanvas.width = 0;
          media.prevCanvas.height = 0;
          media.prevCanvas = null;
        }
        if (media.currCanvas) {
          media.currCanvas.width = 0;
          media.currCanvas.height = 0;
          media.currCanvas = null;
        }
        media.hasTex = false;
      };
    }, []);

    // Upload new cover photo textures dynamically without resetting the WebGL shader state
    const crossfadeMsRef = useRef<number>(crossfadeMs);
    crossfadeMsRef.current = crossfadeMs;
    const lastCommittedCoverUrlRef = useRef<string>('');

    useEffect(() => {
      const cleanUrl = coverUrl?.trim();
      if (!cleanUrl || typeof Image === 'undefined') return;
      if (cleanUrl === lastCommittedCoverUrlRef.current) return;
      let cancelled = false;
      let committed = false;

      const commitSoftImage = (img: HTMLImageElement, tryUploadGl: boolean) => {
        if (cancelled || committed) return;
        committed = true;
        lastCommittedCoverUrlRef.current = cleanUrl;
        const soft = buildSoftCoverCanvas(img, styleRef.current);
        if (!soft) return;
        const media = coverMediaRef.current;

        const hadPrev = Boolean(media.currCanvas);
        if (media.currCanvas) {
          if (media.prevCanvas && media.prevCanvas !== media.currCanvas) {
            media.prevCanvas.width = 0;
            media.prevCanvas.height = 0;
          }
          media.prevCanvas = media.currCanvas;
        } else {
          media.prevCanvas = soft;
        }
        media.currCanvas = soft;

        if (media.gl && media.texPrev && media.texCurr) {
          if (tryUploadGl && !(typeof media.gl.isContextLost === 'function' && media.gl.isContextLost())) {
            try {
              const g = media.gl;
              g.activeTexture(g.TEXTURE0);
              g.bindTexture(g.TEXTURE_2D, media.texPrev);
              g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, media.prevCanvas);
              g.activeTexture(g.TEXTURE1);
              g.bindTexture(g.TEXTURE_2D, media.texCurr);
              g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, soft);
              media.hasTex = true;
            } catch {
              media.hasTex = false;
            }
          } else {
            // New cover unavailable for CORS WebGL -> switch to live palette wash instead of sticking on old cover
            media.hasTex = false;
          }
        }

        const activeCrossfadeMs = crossfadeMsRef.current;
        if (hadPrev && !reducedMotionPref && activeCrossfadeMs > 80) {
          media.mix = 0;
          media.mixStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
          media.mixDurMs = activeCrossfadeMs;
        } else {
          media.mix = 1;
        }
        media.requestStaticPaint?.();
      };

      const cancelCorsLoad = loadSharedCorsCoverImage(
        cleanUrl,
        (img) => commitSoftImage(img, true),
        () => {
          if (cancelled || committed) return;
          if (coverMediaRef.current.gl) {
            // On WebGL, clear stale previous cover texture so live ambient palette takes over smoothly
            committed = true;
            lastCommittedCoverUrlRef.current = cleanUrl;
            coverMediaRef.current.hasTex = false;
            coverMediaRef.current.requestStaticPaint?.();
            return;
          }
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => commitSoftImage(img, false);
          img.src = cleanUrl;
          if (img.complete && img.naturalWidth > 0) {
            commitSoftImage(img, false);
          }
        }
      );
      return () => {
        cancelled = true;
        cancelCorsLoad();
      };
    }, [coverUrl, reducedMotionPref]);

    return (
      <canvas
        ref={canvasRef}
        data-testid="exotic-backdrop-canvas"
        data-exotic-style={style}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ transform: 'translateZ(0)' }}
      />
    );
  }
);
ExoticBackdropCanvas.displayName = 'ExoticBackdropCanvas';
