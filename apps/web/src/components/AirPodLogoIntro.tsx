import React, { useEffect, useRef, useState } from 'react';
import { PMusicLogo } from './PMusicLogo.tsx';
import { triggerHaptic } from '../utils/haptics.ts';

export interface AirPodLogoIntroProps {
  onComplete: () => void;
}

const VERTEX_SHADER_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uMorph;
uniform float uAngleY;
uniform float uTiltX;
uniform float uRevealAlpha;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// Returns vec2(signedDistance, materialId)
// matId: 0 = glossy ceramic white, 1 = dark acoustic mesh, 2 = brushed chrome ring, 3 = obsidian inner core
vec2 mapScene(vec3 rawP) {
  vec3 p = rawP;
  p.yz = rot2(p.yz, uTiltX);
  p.xz = rot2(p.xz, uAngleY);

  // Sculpted 3D AirPod oriented so stem is on the left & bulb curves upper-right (matching "p" geometry)
  float dStem = sdCapsule(p, vec3(-0.24, -0.52, 0.0), vec3(-0.23, 0.24, 0.0), 0.088);
  // Subtle flat capacitive pinch sensor indentation on stem front
  float pinch = sdRoundBox(p - vec3(-0.235, -0.20, 0.095), vec3(0.036, 0.14, 0.03), 0.015);
  dStem = max(dStem, -pinch * 0.45);

  // Curved elbow + acoustic head bulb pointing upper-right (+x, +y)
  float dElbow = sdCapsule(p, vec3(-0.23, 0.22, 0.0), vec3(0.02, 0.30, 0.04), 0.125);
  vec3 hp = p - vec3(0.11, 0.26, 0.08);
  hp.xy = rot2(hp.xy, -0.22);
  float dHead = sdEllipsoid(hp, vec3(0.24, 0.205, 0.185));

  // Tapered ear nozzle protruding slightly toward viewer-right
  vec3 np = p - vec3(0.26, 0.23, 0.17);
  np.xy = rot2(np.xy, -0.28);
  float dNozzle = sdEllipsoid(np, vec3(0.145, 0.125, 0.11));

  float dAirPodBody = smin(dStem, dElbow, 0.085);
  dAirPodBody = smin(dAirPodBody, dHead, 0.095);
  dAirPodBody = smin(dAirPodBody, dNozzle, 0.075);

  // Dark acoustic mesh oval inside the ear nozzle & side vent
  float dMesh = sdEllipsoid(np - vec3(0.06, 0.0, 0.06), vec3(0.085, 0.068, 0.055));
  float dVent = sdEllipsoid(p - vec3(0.02, 0.32, 0.245), vec3(0.058, 0.022, 0.024));

  // Chrome charging collar ring at the bottom of the stem
  vec3 cp = p - vec3(-0.24, -0.535, 0.0);
  float dCollar = sdTorus(cp, vec2(0.078, 0.022));
  float dTip = sdCapsule(p, vec3(-0.24, -0.555, 0.0), vec3(-0.24, -0.585, 0.0), 0.064);
  float dChrome = min(dCollar, dTip);

  // Sculpted 3D extruded & beveled "p" logo mark
  float pStem = sdCapsule(p, vec3(-0.23, -0.56, 0.0), vec3(-0.23, 0.38, 0.0), 0.118);
  vec3 lp = p - vec3(0.02, 0.16, 0.0);
  float dLoopOuter = sdEllipsoid(lp, vec3(0.32, 0.34, 0.135));
  float dLoopHole = sdEllipsoid(lp - vec3(-0.02, 0.0, 0.0), vec3(0.145, 0.165, 0.28));
  float dPMarkBody = smin(pStem, dLoopOuter, 0.065);
  dPMarkBody = max(dPMarkBody, -dLoopHole);

  float m = smoothstep(0.0, 1.0, uMorph);
  float dMain = mix(dAirPodBody, dPMarkBody, m);

  vec2 res = vec2(dMain, 0.0);
  if (m < 0.72) {
    float meshFade = mix(dMesh, dMain + 0.08, smoothstep(0.15, 0.72, m));
    float ventFade = mix(dVent, dMain + 0.08, smoothstep(0.10, 0.65, m));
    if (meshFade < res.x) res = vec2(meshFade, 1.0);
    if (ventFade < res.x) res = vec2(ventFade, 1.0);
    float chromeFade = mix(dChrome, dMain + 0.06, smoothstep(0.2, 0.75, m));
    if (chromeFade < res.x) res = vec2(chromeFade, 2.0);
  }
  return res;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0018, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy).x - mapScene(p - e.xyy).x,
    mapScene(p + e.yxy).x - mapScene(p - e.yxy).x,
    mapScene(p + e.yyx).x - mapScene(p - e.yyx).x
  ));
}

// Analytical studio softbox environment reflection
vec3 studioEnv(vec3 r) {
  vec3 col = vec3(0.03, 0.032, 0.055);
  // Warm overhead softbox strip
  float strip = smoothstep(0.76, 0.94, dot(r, normalize(vec3(0.18, 0.88, 0.42))));
  col += vec3(1.15, 1.12, 1.08) * strip;
  // Crisp vertical left studio panel
  float leftPanel = smoothstep(0.58, 0.88, dot(r, normalize(vec3(-0.78, 0.25, 0.56))));
  col += vec3(0.75, 0.84, 1.05) * leftPanel * 0.85;
  // Subtle lavender/violet studio rim card
  float rimCard = smoothstep(0.52, 0.86, dot(r, normalize(vec3(0.72, -0.35, -0.55))));
  col += vec3(0.68, 0.46, 0.98) * rimCard * 0.72;
  // Floor bounce horizon gleam
  float horizon = exp(-abs(r.y + 0.15) * 9.0) * 0.28;
  col += vec3(0.55, 0.60, 0.78) * horizon;
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.02, 2.35);
  vec3 rd = normalize(vec3(uv, -1.65));

  // Subtle ambient vignette + animated radial spotlight
  float pulse = 0.08 * sin(uTime * 2.2);
  vec3 bg = vec3(0.020, 0.020, 0.028);
  bg += vec3(0.12, 0.10, 0.24) * exp(-length(uv - vec2(0.0, 0.08)) * 2.4);
  bg += vec3(0.06, 0.06, 0.09) * exp(-length(uv) * (4.2 + pulse));

  // Acoustic wave rings triggered during the morph transition
  if (uMorph > 0.04 && uMorph < 0.98) {
    float wavePhase = fract(uMorph * 1.45);
    float ringR = 0.26 + wavePhase * 0.65;
    float ring = exp(-abs(length(uv - vec2(0.0, 0.04)) - ringR) * 58.0) * (1.0 - wavePhase);
    bg += vec3(0.75, 0.58, 1.0) * ring * 0.65;
  }

  float t = 0.0;
  float matId = -1.0;
  bool hit = false;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    vec2 res = mapScene(p);
    if (res.x < 0.0014) {
      hit = true;
      matId = res.y;
      break;
    }
    if (t > 4.5) break;
    t += res.x * 0.85;
  }

  vec3 col = bg;
  if (hit) {
    vec3 pos = ro + rd * t;
    vec3 n = calcNormal(pos);
    vec3 v = -rd;
    vec3 r = reflect(-v, n);

    // 5-tap AO
    float ao = 0.0;
    for (int k = 1; k <= 5; k++) {
      float dist = 0.035 * float(k);
      ao += clamp(mapScene(pos + n * dist).x / dist, 0.0, 1.0);
    }
    ao = clamp(ao / 5.0, 0.18, 1.0);

    vec3 keyDir = normalize(vec3(0.55, 0.78, 0.72));
    vec3 fillDir = normalize(vec3(-0.75, 0.22, 0.55));
    float diffKey = max(dot(n, keyDir), 0.0);
    float diffFill = max(dot(n, fillDir), 0.0);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);

    vec3 halfKey = normalize(keyDir + v);
    float spec = pow(max(dot(n, halfKey), 0.0), matId > 1.5 ? 110.0 : 68.0);
    vec3 envRefl = studioEnv(r);

    if (matId < 0.5) {
      // Glossy Apple-grade ceramic white
      vec3 baseAlbedo = vec3(0.95, 0.96, 0.985);
      col = baseAlbedo * (0.30 + 0.58 * diffKey + 0.24 * diffFill) * ao;
      col += envRefl * (0.14 + 0.68 * fresnel);
      col += vec3(1.0) * spec * 0.75;
    } else if (matId < 1.5) {
      // Matte micro-perforated dark acoustic mesh
      col = vec3(0.035, 0.038, 0.046) * (0.5 + 0.8 * diffKey) * ao;
      col += envRefl * 0.08;
    } else {
      // Polished stainless steel / chrome ring
      col = envRefl * (0.65 + 0.35 * ao) + vec3(1.0) * spec * 1.1;
    }

    // Crisp rim accent
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += vec3(0.72, 0.62, 1.0) * rim * 0.16;
  }

  // Smooth fade-out into final vector lockup during reveal phase
  col = mix(col, bg, clamp(uRevealAlpha, 0.0, 1.0));
  // Filmic tone-mapping & gamma
  col = col / (1.0 + col * 0.25);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

function compileProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  try {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    gl.shaderSource(vs, VERTEX_SHADER_SRC);
    gl.shaderSource(fs, FRAGMENT_SHADER_SRC);
    gl.compileShader(vs);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      return null;
    }
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return prog;
  } catch {
    return null;
  }
}

export const AirPodLogoIntro: React.FC<AirPodLogoIntroProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const completedRef = useRef(false);
  const hapticMorphSentRef = useRef(false);
  const hapticRevealSentRef = useRef(false);

  const [phase, setPhase] = useState<'spin' | 'morph' | 'reveal' | 'handoff'>('spin');
  const [webglReady, setWebglReady] = useState(true);

  const finishOnce = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        setPhase('morph');
        if (!hapticMorphSentRef.current) {
          hapticMorphSentRef.current = true;
          triggerHaptic('medium');
        }
      }, 1700),
      window.setTimeout(() => {
        setPhase('reveal');
        if (!hapticRevealSentRef.current) {
          hapticRevealSentRef.current = true;
          triggerHaptic('confirm');
        }
      }, 2550),
      window.setTimeout(() => setPhase('handoff'), 3600),
      window.setTimeout(() => finishOnce(), 4100)
    );

    const canvas = canvasRef.current;
    let rafId = 0;
    let gl: WebGLRenderingContext | null = null;
    let prog: WebGLProgram | null = null;

    if (canvas) {
      try {
        gl =
          (canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' }) as WebGLRenderingContext | null) ??
          (canvas.getContext('webgl', { antialias: true }) as WebGLRenderingContext | null);
        if (gl) {
          prog = compileProgram(gl);
        }
      } catch {
        gl = null;
        prog = null;
      }
    }

    if (!gl || !prog || !canvas) {
      setWebglReady(false);
      return () => {
        timers.forEach((id) => window.clearTimeout(id));
      };
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uMorph = gl.getUniformLocation(prog, 'uMorph');
    const uAngleY = gl.getUniformLocation(prog, 'uAngleY');
    const uTiltX = gl.getUniformLocation(prog, 'uTiltX');
    const uRevealAlpha = gl.getUniformLocation(prog, 'uRevealAlpha');

    const startMs = performance.now();
    const syncSize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(320, Math.round(window.innerWidth * dpr));
      const h = Math.max(320, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl!.viewport(0, 0, canvas.width, canvas.height);
    };
    syncSize();
    window.addEventListener('resize', syncSize);

    const drawFrame = (nowMs: number) => {
      const elapsedSec = (nowMs - startMs) / 1000;
      const spinProgress = Math.min(1, elapsedSec / 1.7);
      const easedSpin = 1 - Math.pow(1 - spinProgress, 3);
      const angleY =
        elapsedSec < 1.7
          ? -Math.PI * 0.35 + easedSpin * Math.PI * 2.35
          : Math.sin((elapsedSec - 1.7) * 2.2) * 0.08;
      const tiltX = elapsedSec < 1.7 ? Math.sin(spinProgress * Math.PI) * 0.34 : 0.04;
      const morphT = Math.max(0, Math.min(1, (elapsedSec - 1.7) / 0.85));
      const revealAlpha = Math.max(0, Math.min(1, (elapsedSec - 2.55) / 0.35));

      gl!.useProgram(prog);
      gl!.uniform2f(uRes, canvas.width, canvas.height);
      gl!.uniform1f(uTime, elapsedSec);
      gl!.uniform1f(uMorph, morphT);
      gl!.uniform1f(uAngleY, angleY);
      gl!.uniform1f(uTiltX, tiltX);
      gl!.uniform1f(uRevealAlpha, revealAlpha);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      if (elapsedSec < 3.6 && !completedRef.current) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };
    rafId = requestAnimationFrame(drawFrame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncSize);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const showWordmark = phase === 'reveal' || phase === 'handoff';

  return (
    <div
      data-testid="airpod-intro-stage"
      className={`fixed inset-0 z-30 flex flex-col items-center justify-center overflow-hidden bg-[#050507] transition-all duration-500 ${
        phase === 'handoff' ? 'pointer-events-none opacity-0 -translate-y-4 scale-[0.985]' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes pmWordmarkUnfold {
          0% {
            clip-path: inset(0 74% 0 0);
            transform: translate3d(42px, 0, 0) scale(0.96);
            opacity: 0;
          }
          35% {
            opacity: 1;
          }
          100% {
            clip-path: inset(0 0% 0 0);
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 1;
          }
        }
        @keyframes pmSvgAirPodSpin {
          0% { transform: perspective(700px) rotateY(-180deg) rotateX(18deg) scale(0.86); opacity: 0.2; }
          65% { transform: perspective(700px) rotateY(22deg) rotateX(6deg) scale(1.04); opacity: 1; }
          100% { transform: perspective(700px) rotateY(0deg) rotateX(0deg) scale(1); opacity: 1; }
        }
        .pm-airpod-wordmark-reveal {
          animation: pmWordmarkUnfold 820ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .pm-svg-airpod-spin {
          animation: pmSvgAirPodSpin 1.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>

      {/* Real-time WebGL 3D PBR AirPod -> pMusic "p" Morph Canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full ${webglReady ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* CSS 3D fallback when WebGL is unavailable (e.g. jsdom / headless software) */}
      {!webglReady && !showWordmark && (
        <div
          aria-hidden="true"
          className="pm-svg-airpod-spin relative z-10 flex flex-col items-center justify-center"
        >
          <div className="relative flex h-44 w-44 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(192,132,252,0.22),transparent_70%)]">
            {phase === 'spin' ? (
              <svg viewBox="0 0 120 150" className="h-36 w-28 drop-shadow-[0_14px_30px_rgba(255,255,255,0.22)]">
                <defs>
                  <linearGradient id="apBody" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="55%" stopColor="#e4e4ec" />
                    <stop offset="100%" stopColor="#a1a1b5" />
                  </linearGradient>
                </defs>
                <rect x="24" y="34" width="22" height="96" rx="11" fill="url(#apBody)" />
                <ellipse cx="64" cy="40" rx="34" ry="25" fill="url(#apBody)" />
                <ellipse cx="78" cy="40" rx="10" ry="7" fill="#14141b" />
                <rect x="26" y="122" width="18" height="8" rx="4" fill="#94a3b8" />
              </svg>
            ) : (
              <PMusicLogo size={118} variant="mark" color="#FFFFFF" />
            )}
          </div>
        </div>
      )}

      {/* Phase 3: Seamless vector reveal from "p" out into full "pMusic" wordmark */}
      {showWordmark && (
        <div className="pm-airpod-wordmark-reveal relative z-20 flex flex-col items-center justify-center px-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-12 rounded-full bg-white/[0.08] blur-3xl"
          />
          <PMusicLogo size={72} variant="wordmark-only" animated color="#FFFFFF" />
        </div>
      )}

      {/* Skip control */}
      <button
        type="button"
        data-testid="airpod-intro-skip"
        onClick={() => {
          triggerHaptic('light');
          finishOnce();
        }}
        className="pm-no-drag fixed right-6 top-[max(1.25rem,var(--pm-safe-top,env(safe-area-inset-top)))] z-40 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-white/75 backdrop-blur-md transition hover:border-white/30 hover:bg-white/[0.12] hover:text-white"
      >
        Saltar
      </button>
    </div>
  );
};
