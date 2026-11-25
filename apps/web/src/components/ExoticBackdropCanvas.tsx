import React, { useEffect, useRef } from 'react';
import {
  getLiveAmbientLuminance,
  getLiveAmbientQuad,
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
}

const TEX_SIZE = 128;

const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const PAINT_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform sampler2D u_texPrev;
uniform sampler2D u_texCurr;
uniform float u_mix;
uniform float u_hasTex;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform float u_luma;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.05 + vec2(1.7, 9.2);
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
  vec2 uv = (v_uv - 0.5) * vec2(u_res.x / max(1.0, u_res.y), 1.0) * 1.38;
  float t = u_time * 0.22;

  vec2 q = vec2(
    fbm(uv + vec2(t * 0.62, -t * 0.4)),
    fbm(uv + vec2(-t * 0.46, t * 0.68) + vec2(5.2, 1.3))
  );
  vec2 r = vec2(
    fbm(uv + 1.95 * q + vec2(1.7, 9.2) + 0.34 * t),
    fbm(uv + 1.95 * q + vec2(8.3, 2.8) - 0.31 * t)
  );
  float f = fbm(uv + 1.8 * r);

  vec2 coverUv1 = v_uv * 0.86 + 0.07 + (q - 0.5) * 0.42 + (r - 0.5) * 0.34;
  vec2 coverUv2 = vec2(1.0 - v_uv.x, v_uv.y) * 0.84 + 0.08 + (r - 0.5) * 0.46;
  vec2 coverUv3 = rot2(v_uv - 0.5, t * 0.14) * 0.78 + 0.5 + (q.yx - 0.5) * 0.36;

  vec3 s1 = sampleCover(coverUv1);
  vec3 s2 = sampleCover(coverUv2);
  vec3 s3 = sampleCover(coverUv3);

  vec3 col = mix(s1, s2, smoothstep(0.2, 0.8, f));
  col = mix(col, s3, smoothstep(0.28, 0.86, length(q) * 0.76) * 0.68);

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.08);

  float vig = 1.0 - smoothstep(0.42, 1.24, length(v_uv - 0.5) * 1.12);
  col *= mix(0.76, 1.02, vig);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// Softly blurred irregular organic kaleidoscope of the REAL album cover photo
const PULSE_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform sampler2D u_texPrev;
uniform sampler2D u_texCurr;
uniform float u_mix;
uniform float u_hasTex;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_c4;
uniform float u_luma;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.76, 0.65, -0.65, 0.76);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 1.95 + vec2(2.3, 4.7);
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
  float aspect = u_res.x / max(1.0, u_res.y);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * 0.26;

  float rawR = length(p);
  float rawAng = atan(p.y, p.x);
  float wobble = fbm(p * 1.6 + vec2(t * 0.44, -t * 0.34));
  float symAng = rawAng + sin(rawR * 3.1 - t * 0.85) * 0.46 + (wobble - 0.5) * 1.12;
  float sector = 3.14159265 / 3.0;
  float folded = abs(mod(symAng + sector * 0.5, sector * 2.0) - sector);

  float breathR = rawR * (1.12 + 0.06 * sin(t * 0.75)) + (wobble - 0.5) * 0.26;
  vec2 kPos = vec2(cos(folded), sin(folded)) * breathR;

  float swirlB = fbm(kPos * 1.45 - vec2(t * 0.36, wobble * 1.05) + vec2(4.1, 1.9));
  float ringWave = 0.5 + 0.5 * sin(breathR * 6.0 - t * 1.9 - swirlB * 2.4);

  vec2 uvA = kPos * 0.62 + 0.5 + vec2(sin(t * 0.25), cos(t * 0.21)) * 0.12;
  vec2 uvB = vec2(kPos.y, -kPos.x) * 0.54 + 0.5 + (wobble - 0.5) * 0.22;

  vec3 sA = sampleCover(uvA);
  vec3 sB = sampleCover(uvB);
  vec3 col = mix(sA, sB, smoothstep(0.2, 0.8, swirlB));

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.06);
  col *= 0.94 + 0.12 * ringWave;

  float coreSoft = 1.0 - smoothstep(0.2, 1.2, rawR);
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

function buildSoftCoverCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !img.complete || img.naturalWidth <= 0) return null;
  try {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const side = Math.min(iw, ih);
    const sx = (iw - side) * 0.5;
    const sy = (ih - side) * 0.5;

    const pass1 = document.createElement('canvas');
    pass1.width = 96;
    pass1.height = 96;
    const c1 = pass1.getContext('2d');

    const pass2 = document.createElement('canvas');
    pass2.width = 20;
    pass2.height = 20;
    const c2 = pass2.getContext('2d');

    const out = document.createElement('canvas');
    out.width = TEX_SIZE;
    out.height = TEX_SIZE;
    const cOut = out.getContext('2d');
    if (!c1 || !c2 || !cOut) return null;

    c1.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in c1) c1.imageSmoothingQuality = 'high';
    c1.drawImage(img, sx, sy, side, side, 0, 0, 96, 96);

    c2.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in c2) c2.imageSmoothingQuality = 'high';
    c2.drawImage(pass1, 0, 0, 20, 20);

    cOut.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in cOut) cOut.imageSmoothingQuality = 'high';
    cOut.drawImage(pass2, 0, 0, TEX_SIZE, TEX_SIZE);

    pass1.width = 0;
    pass1.height = 0;
    pass2.width = 0;
    pass2.height = 0;
    return out;
  } catch {
    return null;
  }
}

export const ExoticBackdropCanvas: React.FC<ExoticBackdropCanvasProps> = ({
  style,
  coverUrl,
  crossfadeMs = 950,
  isPlaying,
  ambientMotionEnabled,
  reducedMotionPref,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const styleRef = useRef<ExoticBackdropStyle>(style);
  styleRef.current = style;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

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
    let uTime: WebGLUniformLocation | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uTexPrev: WebGLUniformLocation | null = null;
    let uTexCurr: WebGLUniformLocation | null = null;
    let uMix: WebGLUniformLocation | null = null;
    let uHasTex: WebGLUniformLocation | null = null;
    let uC1: WebGLUniformLocation | null = null;
    let uC2: WebGLUniformLocation | null = null;
    let uC3: WebGLUniformLocation | null = null;
    let uC4: WebGLUniformLocation | null = null;
    let uLuma: WebGLUniformLocation | null = null;
    let texPrev: WebGLTexture | null = null;
    let texCurr: WebGLTexture | null = null;

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

    try {
      gl =
        (canvas.getContext('webgl', { alpha: false, antialias: false, depth: false }) as WebGLRenderingContext | null) ??
        (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
      if (gl) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
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
              const buf = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, buf);
              gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
                gl.STATIC_DRAW
              );
              const loc = gl.getAttribLocation(prog, 'a_pos');
              gl.enableVertexAttribArray(loc);
              gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
              uTime = gl.getUniformLocation(prog, 'u_time');
              uRes = gl.getUniformLocation(prog, 'u_res');
              uTexPrev = gl.getUniformLocation(prog, 'u_texPrev');
              uTexCurr = gl.getUniformLocation(prog, 'u_texCurr');
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
        ctx2d = canvas.getContext('2d');
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
        gl.bindTexture(gl.TEXTURE_2D, texPrev);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.prevCanvas);
      } catch {
        // ignore upload fallback
      }
    }
    if (gl && media.currCanvas && texCurr) {
      try {
        gl.bindTexture(gl.TEXTURE_2D, texCurr);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media.currCanvas);
        media.hasTex = true;
      } catch {
        // ignore upload fallback
      }
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const baseW = Math.max(240, rect.width || (typeof window !== 'undefined' ? window.innerWidth : 640));
      const baseH = Math.max(240, rect.height || (typeof window !== 'undefined' ? window.innerHeight : 640));
      if (glProg) {
        const scale = isMobileLike ? 0.42 : 0.55;
        canvas.width = Math.min(560, Math.round(baseW * scale));
        canvas.height = Math.min(560, Math.round(baseH * scale));
      } else {
        const scale = isMobileLike ? 0.55 : 0.78;
        canvas.width = Math.min(960, Math.round(baseW * scale));
        canvas.height = Math.min(960, Math.round(baseH * scale));
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
      const frameBudgetMs = staticMode ? 120 : isMobileLike ? 30 : 16;
      if (now - lastDrawMs < frameBudgetMs && lastDrawMs > 0) {
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

      const [c1Raw, c2Raw, c3Raw, c4Raw] = getLiveAmbientQuad();
      const coverLuma = getLiveAmbientLuminance();
      const t = accumTimeSec;

      if (gl && glProg) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(glProg);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        if (texPrev && uTexPrev) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texPrev);
          gl.uniform1i(uTexPrev, 0);
        }
        if (texCurr && uTexCurr) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, texCurr);
          gl.uniform1i(uTexCurr, 1);
        }
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
            ctx2d!.save();
            ctx2d!.globalCompositeOperation = 'source-over';
            ctx2d!.globalAlpha = alpha;
            if (curStyle === 'paint') {
              ctx2d!.drawImage(source, -w * 0.08, -h * 0.08, w * 1.16, h * 1.16);
              ctx2d!.globalAlpha = alpha * 0.45;
              const cx = w * (0.5 + 0.08 * Math.cos(t * 0.3));
              const cy = h * (0.5 + 0.08 * Math.sin(t * 0.26));
              ctx2d!.translate(cx, cy);
              ctx2d!.rotate(t * 0.14);
              ctx2d!.scale(-1, 1);
              ctx2d!.drawImage(source, -w * 0.65, -h * 0.65, w * 1.3, h * 1.3);
            } else {
              const cx = w * 0.5;
              const cy = h * 0.5;
              ctx2d!.drawImage(source, -w * 0.06, -h * 0.06, w * 1.12, h * 1.12);
              const petals = 6;
              for (let k = 0; k < petals; k++) {
                ctx2d!.save();
                ctx2d!.globalAlpha = alpha * 0.24;
                ctx2d!.translate(cx, cy);
                ctx2d!.rotate((k / petals) * Math.PI * 2 + t * 0.16);
                if (k % 2 === 1) ctx2d!.scale(-1, 1);
                ctx2d!.drawImage(source, -w * 0.58, -h * 0.58, w * 1.16, h * 1.16);
                ctx2d!.restore();
              }
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
    } else if (typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden)) {
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
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      if (ro) ro.disconnect();
      if (gl && texPrev) {
        try {
          gl.deleteTexture(texPrev);
        } catch {
          // ignore
        }
      }
      if (gl && texCurr) {
        try {
          gl.deleteTexture(texCurr);
        } catch {
          // ignore
        }
      }
      if (gl && glProg) {
        try {
          gl.deleteProgram(glProg);
        } catch {
          // ignore WebGL teardown failure
        }
      }
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [style, ambientMotionEnabled, reducedMotionPref]);

  // Upload new cover photo textures dynamically without resetting the WebGL shader state
  useEffect(() => {
    const cleanUrl = coverUrl?.trim();
    if (!cleanUrl || typeof Image === 'undefined') return;
    let cancelled = false;

    const commitSoftImage = (img: HTMLImageElement, tryUploadGl: boolean) => {
      if (cancelled) return;
      const soft = buildSoftCoverCanvas(img);
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

      if (tryUploadGl && media.gl && media.texPrev && media.texCurr) {
        try {
          const g = media.gl;
          g.bindTexture(g.TEXTURE_2D, media.texPrev);
          g.texImage2D(
            g.TEXTURE_2D,
            0,
            g.RGBA,
            g.RGBA,
            g.UNSIGNED_BYTE,
            media.prevCanvas
          );
          g.bindTexture(g.TEXTURE_2D, media.texCurr);
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, soft);
          media.hasTex = true;
        } catch {
          // keep canvas2d / procedural fallback if texture upload restricted
        }
      }

      if (hadPrev && !reducedMotionPref && crossfadeMs > 80) {
        media.mix = 0;
        media.mixStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        media.mixDurMs = crossfadeMs;
      } else {
        media.mix = 1;
      }
      media.requestStaticPaint?.();
    };

    const loadCover = (withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => commitSoftImage(img, withCors);
      img.onerror = () => {
        if (withCors && !cancelled) {
          loadCover(false);
        }
      };
      img.src = cleanUrl;
      if (img.complete && img.naturalWidth > 0) {
        commitSoftImage(img, withCors);
      }
    };

    loadCover(true);
    return () => {
      cancelled = true;
    };
  }, [coverUrl, crossfadeMs, reducedMotionPref]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="exotic-backdrop-canvas"
      data-exotic-style={style}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};
