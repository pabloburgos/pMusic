import React, { useEffect, useRef } from 'react';
import { getLiveAmbientRgb, type RgbTriple } from '../utils/cover-color.ts';

export type ExoticBackdropStyle = 'paint' | 'pulse';

interface ExoticBackdropCanvasProps {
  style: ExoticBackdropStyle;
  isPlaying: boolean;
  ambientMotionEnabled: boolean;
  reducedMotionPref: boolean;
}

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
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

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

vec3 boostVivid(vec3 c) {
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(luma), c, 1.5) * 1.16, 0.0, 1.0);
}

void main() {
  vec2 uv = (v_uv - 0.5) * vec2(u_res.x / max(1.0, u_res.y), 1.0) * 1.42;
  float t = u_time * 0.24;
  vec2 q = vec2(
    fbm(uv + vec2(t * 0.65, -t * 0.42)),
    fbm(uv + vec2(-t * 0.48, t * 0.72) + vec2(5.2, 1.3))
  );
  vec2 r = vec2(
    fbm(uv + 2.35 * q + vec2(1.7, 9.2) + 0.38 * t),
    fbm(uv + 2.35 * q + vec2(8.3, 2.8) - 0.34 * t)
  );
  float f = fbm(uv + 2.1 * r);

  vec3 c1 = boostVivid(u_c1);
  vec3 c2 = boostVivid(u_c2);
  vec3 c3 = u_c3 * 0.72;
  vec3 comp = mix(c3, c1, smoothstep(0.18, 0.72, f));
  comp = mix(comp, c2, smoothstep(0.32, 0.88, length(q) * 0.72));
  float ridge = smoothstep(0.62, 0.88, abs(q.x - q.y) + 0.32 * f);
  comp += ridge * mix(c1, c2, 0.5) * 0.32;

  float vig = 1.0 - smoothstep(0.35, 1.18, length(v_uv - 0.5) * 1.18);
  comp *= mix(0.42, 1.0, vig);
  gl_FragColor = vec4(clamp(comp, 0.0, 1.0), 1.0);
}
`;

// Softly blurred irregular organic tie-dye kaleidoscope with continuous fluid motion (no sound reactivity)
const PULSE_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_res;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

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

vec3 boostVivid(vec3 c) {
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(luma), c, 1.62) * 1.18, 0.0, 1.0);
}

void main() {
  float aspect = u_res.x / max(1.0, u_res.y);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * 0.28;

  // Irregular flowing polar warp for blurred organic tie-dye folds
  float rawR = length(p);
  float rawAng = atan(p.y, p.x);
  float wobble = fbm(p * 1.65 + vec2(t * 0.45, -t * 0.35));
  float symAng = rawAng + sin(rawR * 3.1 - t * 0.9) * 0.48 + (wobble - 0.5) * 1.15;
  float sector = 3.14159265 / 3.0;
  float folded = abs(mod(symAng + sector * 0.5, sector * 2.0) - sector);

  float breathR = rawR * (1.14 + 0.06 * sin(t * 0.75)) + (wobble - 0.5) * 0.28;
  vec2 kPos = vec2(cos(folded), sin(folded)) * breathR;

  float swirlA = fbm(kPos * 2.1 + vec2(t * 0.55, wobble * 1.4));
  float swirlB = fbm(kPos * 1.35 - vec2(t * 0.38, swirlA * 1.1) + vec2(4.1, 1.9));
  float ringWave = 0.5 + 0.5 * sin(breathR * 6.2 - t * 2.0 - swirlA * 2.6);

  vec3 c1 = boostVivid(u_c1);
  vec3 c2 = boostVivid(u_c2);
  vec3 cGlow = mix(c1, vec3(1.0, 0.88, 0.95) * 0.85, 0.28);
  vec3 cDeep = u_c3 * 0.42;

  vec3 col = mix(cDeep, c1, smoothstep(0.18, 0.78, swirlA));
  col = mix(col, c2, smoothstep(0.28, 0.84, swirlB));
  col += cGlow * pow(ringWave, 2.2) * 0.22;

  float coreSoft = 1.0 - smoothstep(0.15, 1.12, rawR);
  col *= mix(0.34, 0.95, coreSoft);
  gl_FragColor = vec4(clamp(col * 0.88, 0.0, 1.0), 1.0);
}
`;

function boostRgb([r, g, b]: RgbTriple, sat = 1.48, mult = 1.2): RgbTriple {
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

export const ExoticBackdropCanvas: React.FC<ExoticBackdropCanvasProps> = ({
  style,
  isPlaying,
  ambientMotionEnabled,
  reducedMotionPref,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const styleRef = useRef<ExoticBackdropStyle>(style);
  styleRef.current = style;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

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
    let uC1: WebGLUniformLocation | null = null;
    let uC2: WebGLUniformLocation | null = null;
    let uC3: WebGLUniformLocation | null = null;

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
              uC1 = gl.getUniformLocation(prog, 'u_c1');
              uC2 = gl.getUniformLocation(prog, 'u_c2');
              uC3 = gl.getUniformLocation(prog, 'u_c3');
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
      const frameBudgetMs = staticMode ? 1000 : isMobileLike ? 30 : 16;
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

      const [c1Raw, c2Raw, c3Raw] = getLiveAmbientRgb();
      const t = accumTimeSec;

      if (gl && glProg) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(glProg);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform3f(uC1, c1Raw[0] / 255, c1Raw[1] / 255, c1Raw[2] / 255);
        gl.uniform3f(uC2, c2Raw[0] / 255, c2Raw[1] / 255, c2Raw[2] / 255);
        gl.uniform3f(uC3, c3Raw[0] / 255, c3Raw[1] / 255, c3Raw[2] / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else if (ctx2d) {
        const w = canvas.width;
        const h = canvas.height;
        const vivid1 = boostRgb(c1Raw, 1.5, 1.22);
        const vivid2 = boostRgb(c2Raw, 1.46, 1.18);
        const curStyle = styleRef.current;

        ctx2d.globalCompositeOperation = 'source-over';
        ctx2d.fillStyle = rgbStr(c3Raw, 1);
        ctx2d.fillRect(0, 0, w, h);

        if (curStyle === 'paint') {
          for (let i = 0; i < 6; i++) {
            const ang = t * (0.28 + i * 0.07) + i * 1.05;
            const cx = w * (0.5 + 0.34 * Math.cos(ang));
            const cy = h * (0.5 + 0.32 * Math.sin(ang * 1.25));
            const rad = Math.max(w, h) * (0.34 + 0.1 * Math.sin(t * 0.5 + i));
            const col = i % 2 === 0 ? vivid1 : vivid2;
            const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, rad);
            grad.addColorStop(0, rgbStr(col, 0.88));
            grad.addColorStop(0.55, rgbStr(col, 0.38));
            grad.addColorStop(1, rgbStr(col, 0));
            ctx2d.globalCompositeOperation = i % 2 === 0 ? 'screen' : 'lighter';
            ctx2d.fillStyle = grad;
            ctx2d.fillRect(0, 0, w, h);
          }
        } else {
          ctx2d.save();
          ctx2d.filter = 'blur(26px)';
          ctx2d.globalCompositeOperation = 'screen';
          const cx = w * 0.5;
          const cy = h * 0.5;
          const lobes = 6;
          for (let k = 0; k < lobes; k++) {
            const ang = (k / lobes) * Math.PI * 2 + t * 0.22 + Math.sin(t * 0.4 + k) * 0.28;
            const dist = Math.min(w, h) * (0.16 + 0.08 * Math.sin(t * 0.6 + k * 1.7));
            const lx = cx + Math.cos(ang) * dist;
            const ly = cy + Math.sin(ang) * dist;
            const lr = Math.max(w, h) * (0.38 + 0.06 * Math.cos(t * 0.5 + k));
            const col = k % 2 === 0 ? vivid1 : vivid2;
            const g = ctx2d.createRadialGradient(lx, ly, 0, lx, ly, lr);
            g.addColorStop(0, rgbStr(col, 0.78));
            g.addColorStop(0.55, rgbStr(col, 0.3));
            g.addColorStop(1, rgbStr(col, 0));
            ctx2d.fillStyle = g;
            ctx2d.fillRect(0, 0, w, h);
          }
          ctx2d.restore();
        }
      }

      if (!staticMode && typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    if (staticMode) {
      renderFrame(startMs);
    } else if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(renderFrame);
    } else {
      renderFrame(startMs);
    }

    return () => {
      cancelled = true;
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      if (ro) ro.disconnect();
    };
  }, [style, ambientMotionEnabled, reducedMotionPref]);

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
