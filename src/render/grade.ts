import * as THREE from 'three';
import { clamp } from '../game/math';

// Colour grade as a post-process pass. The scene renders linear HDR into a multisampled
// half-float target; this pass tone maps it (Khronos PBR Neutral) and grades it in display
// space. The lights carry the colour of the evening (golden key, peach sunset, cool moon); the
// grade adds the painterly split between warm light and cool shadow, and only at night pulls the
// whole frame towards blue-violet:
//   gold    cool teal shadows, warm cream highlights, green-gold grass, real contrast
//   sunset  violet shadows, peach highlights, grass stays gold
//   night   dark blue-violet shadows, silver highlights, the ramp gives the moonlit hue
// Strongly saturated signal colours (the wolves' danger ring and outline, Pip's marker, the gate
// beacon) are measured before any grading and skip it, so a threat reads the same all evening.
// Plus a gain (brightness), a haze band over the far valley at the top of the frame, a vignette.

interface GradeKey {
  t: number;
  /** Saturation, 1 = untouched. */
  sat: number;
  /** Split tone: colours the shadows and the highlights lean towards, and how far each. */
  shadow: string;
  shadowAmt: number;
  high: string;
  highAmt: number;
  /** Colour ramp by brightness (shadows, mids, highlights) and how strongly it applies. */
  lo: string;
  mid: string;
  hi: string;
  ramp: number;
  /** Exposure multiplier on top of the lighting's own. */
  gain: number;
  contrast: number;
  haze: string;
  hazeAmt: number;
  vignette: number;
}

const KEYS: GradeKey[] = [
  { t: 0.0, sat: 0.8, shadow: '#4f7cb0', shadowAmt: 0.5, high: '#ffe6b8', highAmt: 0.25, lo: '#2e4a6a', mid: '#a09a4a', hi: '#ffe4b0', ramp: 0.04, gain: 1.0, contrast: 1.38, haze: '#ffd9a0', hazeAmt: 0.28, vignette: 0.22 },
  { t: 0.3, sat: 0.82, shadow: '#5470b4', shadowAmt: 0.55, high: '#ffdcaa', highAmt: 0.3, lo: '#32466e', mid: '#b0904a', hi: '#ffd8a0', ramp: 0.04, gain: 1.02, contrast: 1.38, haze: '#ffc88c', hazeAmt: 0.3, vignette: 0.24 },
  { t: 0.45, sat: 0.95, shadow: '#7250c8', shadowAmt: 0.75, high: '#ffcaa8', highAmt: 0.35, lo: '#503a8c', mid: '#c89a6a', hi: '#ffd0b0', ramp: 0.05, gain: 1.06, contrast: 1.3, haze: '#ffa98c', hazeAmt: 0.34, vignette: 0.26 },
  { t: 0.6, sat: 0.9, shadow: '#6648c0', shadowAmt: 0.78, high: '#ffc0b0', highAmt: 0.35, lo: '#463a8a', mid: '#b88a7c', hi: '#ffc4b8', ramp: 0.08, gain: 1.2, contrast: 1.28, haze: '#d094ae', hazeAmt: 0.32, vignette: 0.3 },
  { t: 0.72, sat: 0.78, shadow: '#3c3aa0', shadowAmt: 0.8, high: '#d6d6f8', highAmt: 0.4, lo: '#2c2c70', mid: '#6a62b4', hi: '#d6ccf2', ramp: 0.3, gain: 1.2, contrast: 1.24, haze: '#716ab8', hazeAmt: 0.28, vignette: 0.36 },
  { t: 1.0, sat: 0.7, shadow: '#262a80', shadowAmt: 0.85, high: '#d4deff', highAmt: 0.5, lo: '#181c52', mid: '#5650aa', hi: '#d0d8ff', ramp: 0.4, gain: 1.32, contrast: 1.3, haze: '#383c80', hazeAmt: 0.26, vignette: 0.42 },
];

/** Display-space (sRGB) components of a hex colour. */
function srgb(hex: string, out = new THREE.Vector3()) {
  const n = parseInt(hex.slice(1), 16);
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const va = new THREE.Vector3();
const vb = new THREE.Vector3();

export class GradePass {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Look-dev switch: false shows the tone-mapped render without the grade. */
  enabled = true;
  /** The haze band suits the top-down play camera; the title's low shot shows the real sky. */
  hazeScale = 1;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uExposure: { value: 1 },
        uEnabled: { value: 1 },
        uSat: { value: 1 },
        uShadow: { value: new THREE.Vector3(1, 1, 1) },
        uShadowAmt: { value: 0 },
        uHigh: { value: new THREE.Vector3(1, 1, 1) },
        uHighAmt: { value: 0 },
        uLo: { value: new THREE.Vector3(0.2, 0.2, 0.2) },
        uMid: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uHi: { value: new THREE.Vector3(1, 1, 1) },
        uRamp: { value: 0 },
        uGain: { value: 1 },
        uContrast: { value: 1 },
        uHaze: { value: new THREE.Vector3(1, 1, 1) },
        uHazeAmt: { value: 0 },
        uVignette: { value: 0 },
        uAspect: { value: 1 },
        uSunDir2: { value: new THREE.Vector2(-1, 0) },
        uSunGlow: { value: new THREE.Vector3(1, 0.8, 0.5) },
        uSunAmt: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure, uEnabled, uSat, uShadowAmt, uHighAmt, uRamp, uGain, uContrast, uHazeAmt, uVignette, uAspect;
        uniform vec3 uShadow, uHigh, uLo, uMid, uHi, uHaze, uSunGlow;
        uniform vec2 uSunDir2;
        uniform float uSunAmt;
        varying vec2 vUv;

        // Khronos PBR Neutral tone mapping: keeps the painted hues.
        vec3 neutral(vec3 color) {
          const float start = 0.8 - 0.04;
          const float desat = 0.15;
          float x = min(color.r, min(color.g, color.b));
          float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
          color -= offset;
          float peak = max(color.r, max(color.g, color.b));
          if (peak < start) return color;
          const float d = 1.0 - start;
          float newPeak = 1.0 - d * d / (peak + d - start);
          color *= newPeak / peak;
          float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
          return mix(color, vec3(newPeak), g);
        }
        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }
        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        // The ramp colour for a brightness, scaled back to that brightness.
        vec3 rampAt(float l) {
          vec3 r = l < 0.45 ? mix(uLo, uMid, l / 0.45) : mix(uMid, uHi, (l - 0.45) / 0.55);
          return r * (l / max(luma(r), 0.001));
        }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure * (uEnabled > 0.5 ? uGain : 1.0);
          c = toSRGB(clamp(neutral(max(c, 0.0)), 0.0, 1.0));
          if (uEnabled > 0.5) {
            float l = luma(c);
            // Signal colours (strongly saturated, like the danger ring) are judged before any
            // grading and skip the colour steps entirely.
            float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
            float grade = 1.0 - smoothstep(0.42, 0.62, chroma);
            vec3 g = mix(vec3(l), c, uSat);
            // Warm light, cool shadow: the darkest tones take the shadow colour and the brightest
            // the highlight colour, each at the pixel's own brightness; midtones (lit grass) keep
            // their colour.
            float ws = 1.0 - smoothstep(0.12, 0.34, l);
            float wh = smoothstep(0.45, 0.75, l);
            g = mix(g, uShadow * (l / max(luma(uShadow), 0.001)), ws * uShadowAmt);
            g = mix(g, uHigh * (l / max(luma(uHigh), 0.001)), wh * uHighAmt);
            g = mix(g, rampAt(l), uRamp);
            c = mix(c, g, grade);
            // Contrast around a low pivot keeps highlights bright while shadows deepen.
            c = (c - 0.4) * uContrast + 0.4;
            // Haze over the far side of the valley, which sits at the top of the frame.
            c = mix(c, uHaze, uHazeAmt * smoothstep(0.52, 1.0, vUv.y));
            vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
            // A soft glow on the side of the frame the sun (or moon) is on: the sky the herding
            // camera cannot see, lighting the air on its side of the valley.
            float sunSide = smoothstep(-0.15, 0.95, dot(v, uSunDir2));
            c = 1.0 - (1.0 - c) * (1.0 - uSunGlow * uSunAmt * sunSide);
            c *= 1.0 - uVignette * smoothstep(0.4, 1.1, length(v) * 1.15);
          }
          // A little dither so smooth gradients never band.
          c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(w: number, h: number) {
    this.target.setSize(w, h);
    this.material.uniforms.uAspect.value = w / Math.max(1, h);
  }

  /** Set the grade for mood time t (0 golden hour .. 1 night). */
  apply(t: number, exposure: number) {
    t = clamp(t, 0, 1);
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const s = k * k * (3 - 2 * k);
    const u = this.material.uniforms;
    const m = (x: number, y: number) => x + (y - x) * s;
    const mc = (x: string, y: string, out: THREE.Vector3) => out.copy(srgb(x, va)).lerp(srgb(y, vb), s);
    u.uExposure.value = exposure;
    u.uEnabled.value = this.enabled ? 1 : 0;
    u.uSat.value = m(a.sat, b.sat);
    mc(a.shadow, b.shadow, u.uShadow.value);
    u.uShadowAmt.value = m(a.shadowAmt, b.shadowAmt);
    mc(a.high, b.high, u.uHigh.value);
    u.uHighAmt.value = m(a.highAmt, b.highAmt);
    mc(a.lo, b.lo, u.uLo.value);
    mc(a.mid, b.mid, u.uMid.value);
    mc(a.hi, b.hi, u.uHi.value);
    u.uRamp.value = m(a.ramp, b.ramp);
    u.uGain.value = m(a.gain, b.gain);
    u.uContrast.value = m(a.contrast, b.contrast);
    mc(a.haze, b.haze, u.uHaze.value);
    u.uHazeAmt.value = m(a.hazeAmt, b.hazeAmt) * this.hazeScale;
    u.uVignette.value = m(a.vignette, b.vignette);
  }

  /**
   * Where the sun (or moon) lies from the middle of the frame, as a screen direction, and the
   * colour and strength of the glow on that side.
   */
  setSun(dirX: number, dirY: number, color: THREE.Color, amount: number) {
    const u = this.material.uniforms;
    const l = Math.hypot(dirX, dirY) || 1;
    u.uSunDir2.value.set(dirX / l, dirY / l);
    // Display-space colour for the screen blend.
    const c = color.clone().convertLinearToSRGB();
    u.uSunGlow.value.set(c.r, c.g, c.b);
    u.uSunAmt.value = amount;
  }

  /** Draw the graded image to the screen. */
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
