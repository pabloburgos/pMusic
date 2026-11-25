import React, { useEffect, useRef } from 'react';
import { getLiveAnalyserData } from '../store/usePMusicStore.ts';
import { getLiveAmbientRgb, type RgbTriple } from '../utils/cover-color.ts';

export type ExoticBackdropStyle = 'paint' | 'prism' | 'nebula' | 'pulse';

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
uniform float u_bass;
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
  return clamp(mix(vec3(luma), c, 1.48) * 1.15, 0.0, 1.0);
}

void main() {
  vec2 uv = (v_uv - 0.5) * vec2(u_res.x / max(1.0, u_res.y), 1.0) * 1.45;
  float t = u_time * 0.24;
  vec2 q = vec2(
    fbm(uv + vec2(t * 0.65, -t * 0.42)),
    fbm(uv + vec2(-t * 0.48, t * 0.72) + vec2(5.2, 1.3))
  );
  vec2 r = vec2(
    fbm(uv + 2.35 * q + vec2(1.7, 9.2) + 0.38 * t),
    fbm(uv + 2.35 * q + vec2(8.3, 2.8) - 0.34 * t)
  );
  float f = fbm(uv + 2.1 * r + vec2(u_bass * 0.18));

  vec3 c1 = boostVivid(u_c1);
  vec3 c2 = boostVivid(u_c2);
  vec3 c3 = u_c3 * 0.78;
  vec3 comp = mix(c3, c1, smoothstep(0.18, 0.72, f));
  comp = mix(comp, c2, smoothstep(0.32, 0.88, length(q) * 0.72));
  float ridge = smoothstep(0.62, 0.88, abs(q.x - q.y) + 0.32 * f);
  comp += ridge * mix(c1, c2, 0.5) * (0.28 + u_bass * 0.22);

  float vig = 1.0 - smoothstep(0.35, 1.15, length(v_uv - 0.5) * 1.18);
  comp *= mix(0.45, 1.0, vig);
  gl_FragColor = vec4(clamp(comp, 0.0, 1.0), 1.0);
}
`;

function boostRgb([r, g, b]: RgbTriple, sat = 1.45, mult = 1.18): RgbTriple {
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

const STARS = Array.from({ length: 110 }, (_, i) => {
  const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const x = (seed - Math.floor(seed));
  const seed2 = Math.sin(i * 93.9898 + 19.13) * 19753.1234;
  const y = (seed2 - Math.floor(seed2));
  const depth = 0.25 + ((i * 7) % 10) * 0.08;
  const size = 0.7 + ((i * 13) % 5) * 0.42;
  const phase = (i * 1.37) % (Math.PI * 2);
  return { x, y, depth, size, phase };
});

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

    // Try WebGL1 shader for 'paint' ("Pintura Viva")
    let gl: WebGLRenderingContext | null = null;
    let glProg: WebGLProgram | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uBass: WebGLUniformLocation | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uC1: WebGLUniformLocation | null = null;
    let uC2: WebGLUniformLocation | null = null;
    let uC3: WebGLUniformLocation | null = null;

    if (style === 'paint') {
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
            gl.shaderSource(fs, PAINT_FRAGMENT_SRC);
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
                uBass = gl.getUniformLocation(prog, 'u_bass');
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
        const scale = isMobileLike ? 0.55 : 0.75;
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
    let smoothBass = 0;

    const renderFrame = (now: number) => {
      if (cancelled) return;
      const frameBudgetMs = staticMode ? 1000 : isMobileLike ? 32 : 16;
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
      const analyser = getLiveAnalyserData();
      const bins = analyser.frequencyBins;
      const bassRaw =
        bins.length >= 4
          ? ((bins[0] ?? 0) + (bins[1] ?? 0) + (bins[2] ?? 0) + (bins[3] ?? 0)) / (4 * 255)
          : analyser.rmsLevel;
      smoothBass = smoothBass * 0.78 + Math.max(bassRaw, analyser.rmsLevel * 0.8) * 0.22;

      const t = accumTimeSec;

      if (gl && glProg) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(glProg);
        gl.uniform1f(uTime, t);
        gl.uniform1f(uBass, smoothBass);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform3f(uC1, c1Raw[0] / 255, c1Raw[1] / 255, c1Raw[2] / 255);
        gl.uniform3f(uC2, c2Raw[0] / 255, c2Raw[1] / 255, c2Raw[2] / 255);
        gl.uniform3f(uC3, c3Raw[0] / 255, c3Raw[1] / 255, c3Raw[2] / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else if (ctx2d) {
        const w = canvas.width;
        const h = canvas.height;
        const vivid1 = boostRgb(c1Raw, 1.48, 1.2);
        const vivid2 = boostRgb(c2Raw, 1.45, 1.15);
        const curStyle = styleRef.current;

        ctx2d.globalCompositeOperation = 'source-over';
        ctx2d.fillStyle = rgbStr(c3Raw, 1);
        ctx2d.fillRect(0, 0, w, h);

        if (curStyle === 'paint') {
          // Canvas2D vivid spreading paint marbling fallback
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
        } else if (curStyle === 'prism') {
          // Crystalline diagonal refractive light beams & shards
          ctx2d.globalCompositeOperation = 'screen';
          for (let i = 0; i < 6; i++) {
            const beamAng = -0.55 + Math.sin(t * 0.22 + i * 0.9) * 0.28;
            const cx = w * ((i + 0.5) / 6 + 0.08 * Math.sin(t * 0.3 + i));
            const cy = h * 0.5;
            const bw = w * (0.14 + 0.04 * (i % 3));
            const bh = Math.hypot(w, h) * 1.25;
            ctx2d.save();
            ctx2d.translate(cx, cy);
            ctx2d.rotate(beamAng);
            const g = ctx2d.createLinearGradient(-bw / 2, 0, bw / 2, 0);
            const col = i % 2 === 0 ? vivid1 : vivid2;
            g.addColorStop(0, rgbStr(col, 0));
            g.addColorStop(0.5, rgbStr(col, 0.36 + smoothBass * 0.22));
            g.addColorStop(1, rgbStr(col, 0));
            ctx2d.fillStyle = g;
            ctx2d.fillRect(-bw / 2, -bh / 2, bw, bh);
            ctx2d.restore();
          }
          // Translucent crystal facets
          for (let j = 0; j < 4; j++) {
            const fx = w * (0.25 + j * 0.18 + 0.06 * Math.cos(t * 0.35 + j));
            const fy = h * (0.3 + (j % 2) * 0.35 + 0.06 * Math.sin(t * 0.28 + j));
            const sz = Math.min(w, h) * (0.18 + j * 0.03);
            ctx2d.save();
            ctx2d.translate(fx, fy);
            ctx2d.rotate(t * (0.08 + j * 0.03) * (j % 2 === 0 ? 1 : -1));
            ctx2d.beginPath();
            ctx2d.moveTo(0, -sz);
            ctx2d.lineTo(sz * 0.68, 0);
            ctx2d.lineTo(0, sz);
            ctx2d.lineTo(-sz * 0.68, 0);
            ctx2d.closePath();
            ctx2d.fillStyle = j % 2 === 0 ? rgbStr(vivid1, 0.14) : rgbStr(vivid2, 0.12);
            ctx2d.fill();
            ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx2d.lineWidth = 1;
            ctx2d.stroke();
            ctx2d.restore();
          }
        } else if (curStyle === 'nebula') {
          // Deep cosmic dust clouds + twinkling parallax starfield
          ctx2d.globalCompositeOperation = 'screen';
          for (let k = 0; k < 4; k++) {
            const nx = w * (0.3 + 0.4 * ((k % 2)) + 0.12 * Math.sin(t * 0.18 + k * 1.4));
            const ny = h * (0.28 + 0.42 * (k > 1 ? 1 : 0) + 0.12 * Math.cos(t * 0.15 + k));
            const rNeb = Math.max(w, h) * (0.48 + 0.08 * Math.sin(t * 0.25 + k));
            const col = k % 2 === 0 ? vivid1 : vivid2;
            const g = ctx2d.createRadialGradient(nx, ny, 0, nx, ny, rNeb);
            g.addColorStop(0, rgbStr(col, 0.65));
            g.addColorStop(0.55, rgbStr(col, 0.22));
            g.addColorStop(1, rgbStr(col, 0));
            ctx2d.fillStyle = g;
            ctx2d.fillRect(0, 0, w, h);
          }
          for (const st of STARS) {
            const px = ((st.x + t * 0.008 * st.depth) % 1) * w;
            const py = ((st.y + t * 0.004 * st.depth) % 1) * h;
            const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1.2 + st.depth) + st.phase));
            const alpha = Math.min(1, twinkle * (0.65 + smoothBass * 0.4));
            ctx2d.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
            ctx2d.beginPath();
            ctx2d.arc(px, py, st.size * (0.85 + smoothBass * 0.35), 0, Math.PI * 2);
            ctx2d.fill();
          }
        } else if (curStyle === 'pulse') {
          // Concentric expanding sonic ripples synchronized with music bass
          const cx = w * 0.5;
          const cy = h * 0.44;
          const maxR = Math.hypot(w, h) * 0.62;
          ctx2d.globalCompositeOperation = 'screen';
          const bg = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.85);
          bg.addColorStop(0, rgbStr(vivid1, 0.55 + smoothBass * 0.28));
          bg.addColorStop(0.5, rgbStr(vivid2, 0.22));
          bg.addColorStop(1, rgbStr(c3Raw, 0));
          ctx2d.fillStyle = bg;
          ctx2d.fillRect(0, 0, w, h);

          for (let rIdx = 0; rIdx < 6; rIdx++) {
            const p = ((t * 0.28 + rIdx / 6) % 1);
            const rad = 24 + p * maxR;
            const fade = Math.pow(1 - p, 1.4) * (0.42 + smoothBass * 0.48);
            const col = rIdx % 2 === 0 ? vivid1 : vivid2;
            ctx2d.strokeStyle = rgbStr(col, fade);
            ctx2d.lineWidth = Math.max(1.5, (1 - p) * (5 + smoothBass * 8));
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx2d.stroke();
          }
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
