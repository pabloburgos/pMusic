import React, { useEffect, useRef } from 'react';
import { getLiveAnalyserData } from '../store/usePMusicStore.ts';
import { getLiveAmbientRgb, type RgbTriple } from '../utils/cover-color.ts';

export type ExoticBackdropStyle = 'paint' | 'nebula' | 'pulse' | 'rhythm';

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
uniform float u_mid;
uniform float u_hit;
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
  float t = u_time * 0.25;
  vec2 q = vec2(
    fbm(uv + vec2(t * 0.65, -t * 0.42)),
    fbm(uv + vec2(-t * 0.48, t * 0.72) + vec2(5.2, 1.3))
  );
  vec2 r = vec2(
    fbm(uv + 2.35 * q + vec2(1.7, 9.2) + 0.38 * t + u_mid * 0.14),
    fbm(uv + 2.35 * q + vec2(8.3, 2.8) - 0.34 * t)
  );
  float f = fbm(uv + 2.1 * r + vec2((u_bass + u_hit * 0.45) * 0.22));

  vec3 c1 = boostVivid(u_c1);
  vec3 c2 = boostVivid(u_c2);
  vec3 c3 = u_c3 * 0.72;
  vec3 comp = mix(c3, c1, smoothstep(0.18, 0.72, f));
  comp = mix(comp, c2, smoothstep(0.32, 0.88, length(q) * 0.72));
  float ridge = smoothstep(0.62, 0.88, abs(q.x - q.y) + 0.32 * f);
  comp += ridge * mix(c1, c2, 0.5) * (0.28 + u_bass * 0.24 + u_hit * 0.22);

  float vig = 1.0 - smoothstep(0.35, 1.18, length(v_uv - 0.5) * 1.18);
  comp *= mix(0.42, 1.0, vig);
  gl_FragColor = vec4(clamp(comp, 0.0, 1.0), 1.0);
}
`;

// Heavily blurred irregular organic tie-dye kaleidoscope tuned for music fullscreen playback
const PULSE_FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_bass;
uniform float u_mid;
uniform float u_hit;
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

  // Irregular flowing polar warp so kaleidoscope petals stay organic & softly blurred
  float rawR = length(p);
  float rawAng = atan(p.y, p.x);
  float wobble = fbm(p * 1.65 + vec2(t * 0.45, -t * 0.35));
  float symAng = rawAng + sin(rawR * 3.1 - t * 0.9) * (0.45 + u_mid * 0.35) + (wobble - 0.5) * 1.15;
  float sector = 3.14159265 / 3.0;
  float folded = abs(mod(symAng + sector * 0.5, sector * 2.0) - sector);

  float breathR = rawR * (1.18 - u_bass * 0.18 - u_hit * 0.14) + (wobble - 0.5) * 0.28;
  vec2 kPos = vec2(cos(folded), sin(folded)) * breathR;

  float swirlA = fbm(kPos * 2.1 + vec2(t * 0.55, wobble * 1.4));
  float swirlB = fbm(kPos * 1.35 - vec2(t * 0.38, swirlA * 1.1) + vec2(4.1, 1.9));
  float ringWave = 0.5 + 0.5 * sin(breathR * 6.5 - t * 2.2 - swirlA * 2.6 + u_bass * 1.8);

  vec3 c1 = boostVivid(u_c1);
  vec3 c2 = boostVivid(u_c2);
  vec3 cGlow = mix(c1, vec3(1.0, 0.88, 0.95) * 0.85, 0.28);
  vec3 cDeep = u_c3 * 0.42;

  vec3 col = mix(cDeep, c1, smoothstep(0.18, 0.78, swirlA));
  col = mix(col, c2, smoothstep(0.28, 0.84, swirlB));
  col += cGlow * pow(ringWave, 2.2) * (0.16 + u_hit * 0.32 + u_bass * 0.18);

  // Dreamy optical blur vignette for clean lyrics legibility
  float coreSoft = 1.0 - smoothstep(0.15, 1.12, rawR);
  col *= mix(0.32, 0.94, coreSoft);
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

interface WarpStar {
  x: number;
  y: number;
  z: number;
  pz: number;
  size: number;
  phase: number;
  tint: 0 | 1 | 2;
}

function createWarpStars(count: number): WarpStar[] {
  return Array.from({ length: count }, (_, i) => {
    const s1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const s2 = Math.sin(i * 93.9898 + 19.13) * 19753.1234;
    const x = ((s1 - Math.floor(s1)) - 0.5) * 2.1;
    const y = ((s2 - Math.floor(s2)) - 0.5) * 2.1;
    const z = 0.08 + ((i * 17) % 100) / 100;
    return {
      x,
      y,
      z,
      pz: z,
      size: 0.9 + (i % 4) * 0.45,
      phase: (i * 1.13) % (Math.PI * 2),
      tint: (i % 3) as 0 | 1 | 2,
    };
  });
}

interface ShockRing {
  bornAt: number;
  strength: number;
  tintIdx: number;
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

    const useShaderStyle = style === 'paint' || style === 'pulse';
    let gl: WebGLRenderingContext | null = null;
    let glProg: WebGLProgram | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uBass: WebGLUniformLocation | null = null;
    let uMid: WebGLUniformLocation | null = null;
    let uHit: WebGLUniformLocation | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uC1: WebGLUniformLocation | null = null;
    let uC2: WebGLUniformLocation | null = null;
    let uC3: WebGLUniformLocation | null = null;

    if (useShaderStyle) {
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
                uBass = gl.getUniformLocation(prog, 'u_bass');
                uMid = gl.getUniformLocation(prog, 'u_mid');
                uHit = gl.getUniformLocation(prog, 'u_hit');
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
        const scale = isMobileLike ? 0.55 : 0.78;
        canvas.width = Math.min(1024, Math.round(baseW * scale));
        canvas.height = Math.min(1024, Math.round(baseH * scale));
      }
    };
    resize();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
    }

    const warpStars = createWarpStars(isMobileLike ? 95 : 150);
    const shockRings: ShockRing[] = [];
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let lastDrawMs = -Infinity;
    let accumTimeSec = 0;
    let lastStepMs = startMs;
    let smoothBass = 0;
    let smoothMid = 0;
    let smoothHigh = 0;
    let rollingBass = 0.08;
    let hitImpulse = 0;
    let lastHitSpawnSec = -1;

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
        accumTimeSec += dt * (isPlayingRef.current ? 1.0 : 0.28);
      }

      const [c1Raw, c2Raw, c3Raw] = getLiveAmbientRgb();
      const analyser = getLiveAnalyserData();
      const bins = analyser.frequencyBins;
      const len = bins.length;

      let bassRaw = analyser.rmsLevel;
      let midRaw = analyser.rmsLevel * 0.85;
      let highRaw = analyser.rmsLevel * 0.7;

      if (len >= 8) {
        const bassEnd = Math.max(4, Math.floor(len * 0.15));
        const midEnd = Math.max(bassEnd + 2, Math.floor(len * 0.55));
        let bSum = 0;
        let mSum = 0;
        let hSum = 0;
        for (let i = 0; i < bassEnd; i++) bSum += bins[i] ?? 0;
        for (let i = bassEnd; i < midEnd; i++) mSum += bins[i] ?? 0;
        for (let i = midEnd; i < len; i++) hSum += bins[i] ?? 0;
        bassRaw = bSum / (bassEnd * 255);
        midRaw = mSum / (Math.max(1, midEnd - bassEnd) * 255);
        highRaw = hSum / (Math.max(1, len - midEnd) * 255);
      }

      // Rhythmic fallback when audio element is silenced/paused or CORS bins read 0 while playing
      if (isPlayingRef.current && bassRaw < 0.015 && analyser.rmsLevel < 0.015) {
        const beatPhase = (accumTimeSec * (118 / 60)) % 1;
        const kickEnv = Math.exp(-beatPhase * 5.2);
        bassRaw = 0.24 + kickEnv * 0.52;
        midRaw = 0.22 + 0.2 * Math.sin(accumTimeSec * 4.2) ** 2;
        highRaw = 0.16 + 0.18 * Math.exp(-(((accumTimeSec * 3.93) % 1) * 6));
      }

      smoothBass = smoothBass * 0.72 + Math.max(bassRaw, analyser.rmsLevel * 0.82) * 0.28;
      smoothMid = smoothMid * 0.78 + midRaw * 0.22;
      smoothHigh = smoothHigh * 0.8 + highRaw * 0.2;
      rollingBass = rollingBass * 0.94 + bassRaw * 0.06;

      // Onset / kick hit detector
      const deltaBass = bassRaw - rollingBass;
      if (deltaBass > 0.085 && bassRaw > rollingBass * 1.24) {
        hitImpulse = Math.min(1, Math.max(hitImpulse, 0.45 + deltaBass * 2.4));
        if (accumTimeSec - lastHitSpawnSec > 0.22) {
          lastHitSpawnSec = accumTimeSec;
          shockRings.push({
            bornAt: accumTimeSec,
            strength: Math.min(1, 0.55 + deltaBass * 2.2),
            tintIdx: shockRings.length % 2,
          });
          if (shockRings.length > 7) shockRings.shift();
        }
      } else {
        hitImpulse *= Math.exp(-dt * 6.4);
      }

      const t = accumTimeSec;

      if (gl && glProg) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(glProg);
        gl.uniform1f(uTime, t);
        gl.uniform1f(uBass, smoothBass);
        if (uMid) gl.uniform1f(uMid, smoothMid);
        if (uHit) gl.uniform1f(uHit, hitImpulse);
        gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.uniform3f(uC1, c1Raw[0] / 255, c1Raw[1] / 255, c1Raw[2] / 255);
        gl.uniform3f(uC2, c2Raw[0] / 255, c2Raw[1] / 255, c2Raw[2] / 255);
        gl.uniform3f(uC3, c3Raw[0] / 255, c3Raw[1] / 255, c3Raw[2] / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } else if (ctx2d) {
        const w = canvas.width;
        const h = canvas.height;
        const vivid1 = boostRgb(c1Raw, 1.52, 1.22);
        const vivid2 = boostRgb(c2Raw, 1.48, 1.18);
        const deepVoid: RgbTriple = [
          Math.max(4, Math.round(c3Raw[0] * 0.22)),
          Math.max(4, Math.round(c3Raw[1] * 0.22)),
          Math.max(7, Math.round(c3Raw[2] * 0.28)),
        ];
        const curStyle = styleRef.current;

        ctx2d.globalCompositeOperation = 'source-over';
        ctx2d.fillStyle = curStyle === 'nebula' ? rgbStr(deepVoid, 1) : rgbStr(c3Raw, 1);
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
        } else if (curStyle === 'pulse') {
          // Canvas2D softly blurred irregular tie-dye kaleidoscope fallback
          ctx2d.save();
          ctx2d.filter = 'blur(26px)';
          ctx2d.globalCompositeOperation = 'screen';
          const cx = w * 0.5;
          const cy = h * 0.5;
          const lobes = 6;
          for (let k = 0; k < lobes; k++) {
            const ang = (k / lobes) * Math.PI * 2 + t * 0.22 + Math.sin(t * 0.4 + k) * 0.28;
            const dist = Math.min(w, h) * (0.16 + 0.07 * Math.sin(t * 0.6 + k * 1.7) + smoothBass * 0.14);
            const lx = cx + Math.cos(ang) * dist;
            const ly = cy + Math.sin(ang) * dist;
            const lr = Math.max(w, h) * (0.36 + hitImpulse * 0.14);
            const col = k % 2 === 0 ? vivid1 : vivid2;
            const g = ctx2d.createRadialGradient(lx, ly, 0, lx, ly, lr);
            g.addColorStop(0, rgbStr(col, 0.72 + hitImpulse * 0.2));
            g.addColorStop(0.55, rgbStr(col, 0.28));
            g.addColorStop(1, rgbStr(col, 0));
            ctx2d.fillStyle = g;
            ctx2d.fillRect(0, 0, w, h);
          }
          ctx2d.restore();
        } else if (curStyle === 'nebula') {
          // Volumetric deep-space cosmic nebula clouds pulsing with beats & hits
          const cx = w * 0.5;
          const cy = h * 0.48;
          ctx2d.globalCompositeOperation = 'screen';
          const cosmicColors: RgbTriple[] = [
            vivid1,
            vivid2,
            [92, 130, 255],
            [186, 110, 255],
          ];
          for (let k = 0; k < 5; k++) {
            const orbit = t * (0.11 + k * 0.03) + k * 1.25;
            const nx = w * (0.5 + 0.26 * Math.cos(orbit) + 0.06 * Math.sin(t * 0.5 + k));
            const ny = h * (0.48 + 0.24 * Math.sin(orbit * 0.85) + 0.06 * Math.cos(t * 0.4 + k));
            const rNeb = Math.max(w, h) * (0.42 + smoothBass * 0.16 + hitImpulse * 0.14);
            const col = cosmicColors[k % cosmicColors.length]!;
            const g = ctx2d.createRadialGradient(nx, ny, 0, nx, ny, rNeb);
            const alphaCenter = Math.min(0.85, 0.42 + smoothBass * 0.24 + hitImpulse * 0.24);
            g.addColorStop(0, rgbStr(col, alphaCenter));
            g.addColorStop(0.45, rgbStr(col, 0.18 + hitImpulse * 0.1));
            g.addColorStop(1, rgbStr(col, 0));
            ctx2d.fillStyle = g;
            ctx2d.fillRect(0, 0, w, h);
          }

          // Central supernova core flash on beat hits
          const coreR = Math.max(w, h) * (0.28 + hitImpulse * 0.24);
          const coreG = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, coreR);
          coreG.addColorStop(0, rgbStr(vivid1, 0.18 + hitImpulse * 0.34));
          coreG.addColorStop(1, rgbStr(vivid2, 0));
          ctx2d.fillStyle = coreG;
          ctx2d.fillRect(0, 0, w, h);

          // 3D warp starfield flying past the listener & stretching on kicks
          const focal = Math.min(w, h) * 0.72;
          const speed = staticMode
            ? 0
            : (0.22 + smoothBass * 0.75 + hitImpulse * 1.85) * dt;
          for (const st of warpStars) {
            st.pz = st.z;
            st.z -= speed * (0.55 + st.size * 0.25);
            if (st.z <= 0.03) {
              st.z = 1.05;
              st.pz = 1.05;
            }
            const sx = cx + (st.x / st.z) * focal;
            const sy = cy + (st.y / st.z) * focal;
            const px = cx + (st.x / Math.max(0.03, st.pz)) * focal;
            const py = cy + (st.y / Math.max(0.03, st.pz)) * focal;
            if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) {
              if (!staticMode && st.z < 0.35) {
                st.z = 1.05;
                st.pz = 1.05;
              }
              continue;
            }
            const proximity = 1 - Math.min(1, st.z);
            const twinkle = 0.65 + 0.35 * Math.sin(t * 2.1 + st.phase);
            const alpha = Math.min(1, proximity * twinkle * (0.7 + hitImpulse * 0.45));
            const starCol =
              st.tint === 1
                ? rgbStr(vivid1, alpha * 0.9)
                : st.tint === 2
                  ? rgbStr(vivid2, alpha * 0.9)
                  : `rgba(255, 255, 255, ${alpha.toFixed(2)})`;

            if (!staticMode && (hitImpulse > 0.15 || smoothBass > 0.28)) {
              ctx2d.strokeStyle = starCol;
              ctx2d.lineWidth = Math.max(0.9, st.size * proximity * (0.85 + hitImpulse * 0.8));
              ctx2d.beginPath();
              ctx2d.moveTo(px, py);
              ctx2d.lineTo(sx, sy);
              ctx2d.stroke();
            } else {
              ctx2d.fillStyle = starCol;
              ctx2d.beginPath();
              ctx2d.arc(sx, sy, Math.max(0.7, st.size * proximity * 1.15), 0, Math.PI * 2);
              ctx2d.fill();
            }
          }
        } else if (curStyle === 'rhythm') {
          // Pure music-reactive shockwaves + 3 layered silk frequency spectrum waves
          const cx = w * 0.5;
          const cy = h * 0.5;
          const maxR = Math.hypot(w, h) * 0.62;
          ctx2d.globalCompositeOperation = 'screen';

          // 1. Sub-bass chest-thump halo
          const thumpR = maxR * (0.45 + smoothBass * 0.35 + hitImpulse * 0.25);
          const halo = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, thumpR);
          halo.addColorStop(0, rgbStr(vivid1, 0.52 + hitImpulse * 0.36));
          halo.addColorStop(0.5, rgbStr(vivid2, 0.24 + smoothMid * 0.2));
          halo.addColorStop(1, rgbStr(deepVoid, 0));
          ctx2d.fillStyle = halo;
          ctx2d.fillRect(0, 0, w, h);

          // 2. Beat-triggered expanding shockwave rings
          for (let i = shockRings.length - 1; i >= 0; i--) {
            const ring = shockRings[i]!;
            const age = t - ring.bornAt;
            if (age > 1.35 || age < 0) {
              shockRings.splice(i, 1);
              continue;
            }
            const prog = age / 1.35;
            const rad = 28 + Math.pow(prog, 0.72) * maxR * 0.95;
            const alpha = Math.pow(1 - prog, 1.6) * (0.65 * ring.strength);
            const col = ring.tintIdx === 0 ? vivid1 : vivid2;
            ctx2d.strokeStyle = rgbStr(col, alpha);
            ctx2d.lineWidth = Math.max(2, (1 - prog) * (10 + smoothBass * 12));
            ctx2d.beginPath();
            ctx2d.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx2d.stroke();
          }

          // 3. Three full-width organic frequency ribbons dancing to Bass / Mid / High
          const bandWaves = [
            { color: vivid1, amp: h * (0.14 + smoothBass * 0.24 + hitImpulse * 0.16), yOff: h * 0.56, freq: 1.8, speed: 1.4, binOffset: 0, lw: 3.5 },
            { color: vivid2, amp: h * (0.1 + smoothMid * 0.22), yOff: h * 0.5, freq: 2.7, speed: -1.9, binOffset: 6, lw: 2.5 },
            { color: [240, 238, 255] as RgbTriple, amp: h * (0.07 + smoothHigh * 0.18 + hitImpulse * 0.1), yOff: h * 0.44, freq: 4.1, speed: 2.5, binOffset: 12, lw: 1.8 },
          ];
          const pointsCount = 26;
          for (const wave of bandWaves) {
            ctx2d.beginPath();
            const pts: Array<{ x: number; y: number }> = [];
            for (let i = 0; i <= pointsCount; i++) {
              const nx = i / pointsCount;
              const x = nx * w;
              const binIdx = wave.binOffset + (i % Math.max(1, Math.min(10, bins.length || 1)));
              const binBoost = bins.length > 0 ? (bins[binIdx % bins.length] ?? 0) / 255 : smoothBass;
              const env = Math.sin(nx * Math.PI);
              const dy =
                Math.sin(nx * Math.PI * wave.freq + t * wave.speed) *
                wave.amp *
                (0.45 + binBoost * 0.75) *
                env;
              pts.push({ x, y: wave.yOff + dy });
            }
            ctx2d.moveTo(pts[0]!.x, pts[0]!.y);
            for (let i = 1; i < pts.length - 1; i++) {
              const mx = (pts[i]!.x + pts[i + 1]!.x) * 0.5;
              const my = (pts[i]!.y + pts[i + 1]!.y) * 0.5;
              ctx2d.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
            }
            const lastPt = pts[pts.length - 1]!;
            ctx2d.lineTo(lastPt.x, lastPt.y);

            // Soft glowing ribbon fill toward bottom + luminous crest stroke
            ctx2d.strokeStyle = rgbStr(wave.color, 0.55 + hitImpulse * 0.35);
            ctx2d.lineWidth = wave.lw + smoothBass * 2.2;
            ctx2d.stroke();

            ctx2d.lineTo(w, h);
            ctx2d.lineTo(0, h);
            ctx2d.closePath();
            const fillGrad = ctx2d.createLinearGradient(0, wave.yOff - wave.amp, 0, h);
            fillGrad.addColorStop(0, rgbStr(wave.color, 0.22 + hitImpulse * 0.16));
            fillGrad.addColorStop(0.65, rgbStr(wave.color, 0.05));
            fillGrad.addColorStop(1, rgbStr(deepVoid, 0));
            ctx2d.fillStyle = fillGrad;
            ctx2d.fill();
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
