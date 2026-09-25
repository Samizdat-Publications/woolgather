import * as THREE from 'three';
import { clamp } from '../game/math';

// Colour grade as a post-process pass. The scene renders linear HDR into a multisampled
// half-float target; this pass tone maps it (Khronos PBR Neutral) and grades it in display
// space with explicit targets for each phase of the evening:
//   gold    amber light, warm haze, muted yellow-greens
//   sunset  coral light, violet shadows
//   night   blue-violet overall, pale silver highlights, low saturation
// plus a haze band toward the top of the frame (the far side of the valley) and a vignette.

interface GradeKey {
  t: number;
  /** Saturation, 1 = untouched. */
  sat: number;
  /** Split tone: the colours shadows and lit surfaces lean towards, and how far each. */
  shadow: string;
  shadowAmt: number;
  high: string;
  highAmt: number;
  /** Soft-light wash over everything. */
  soft: string;
  softAmt: number;
  contrast: number;
  haze: string;
  hazeAmt: number;
  vignette: number;
}

// Warm light, cool shadows. The shadow tint only reaches the darkest tones and the highlight
// tint spares whites, so neutral midtones (the path, stone, wool) keep their own colour; at
// night the blue-violet takes over everything, which is the point.
const KEYS: GradeKey[] = [
  { t: 0.0, sat: 0.9, shadow: '#a9b6e6', shadowAmt: 0.45, high: '#ffdca6', highAmt: 0.45, soft: '#ffb45e', softAmt: 0.2, contrast: 1.04, haze: '#ffd9a0', hazeAmt: 0.3, vignette: 0.22 },
  { t: 0.3, sat: 0.92, shadow: '#a8aee4', shadowAmt: 0.5, high: '#ffd29a', highAmt: 0.45, soft: '#ffa650', softAmt: 0.22, contrast: 1.05, haze: '#ffc88c', hazeAmt: 0.32, vignette: 0.24 },
  { t: 0.45, sat: 1.1, shadow: '#9a82e0', shadowAmt: 0.85, high: '#ffbe9c', highAmt: 0.4, soft: '#ffa890', softAmt: 0.14, contrast: 1.1, haze: '#ffa98c', hazeAmt: 0.34, vignette: 0.26 },
  { t: 0.6, sat: 1.0, shadow: '#8a76dc', shadowAmt: 0.85, high: '#ffb8a8', highAmt: 0.4, soft: '#e0a0c0', softAmt: 0.14, contrast: 1.08, haze: '#d094ae', hazeAmt: 0.32, vignette: 0.3 },
  { t: 0.72, sat: 0.7, shadow: '#6a66cc', shadowAmt: 0.9, high: '#cfcaf2', highAmt: 0.55, soft: '#9a8edc', softAmt: 0.16, contrast: 1.06, haze: '#716ab8', hazeAmt: 0.3, vignette: 0.36 },
  { t: 1.0, sat: 0.55, shadow: '#5256b8', shadowAmt: 0.95, high: '#c8d2ff', highAmt: 0.65, soft: '#7472d2', softAmt: 0.16, contrast: 1.08, haze: '#40428a', hazeAmt: 0.28, vignette: 0.42 },
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
        uSoft: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uSoftAmt: { value: 0 },
        uContrast: { value: 1 },
        uHaze: { value: new THREE.Vector3(1, 1, 1) },
        uHazeAmt: { value: 0 },
        uVignette: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure, uEnabled, uSat, uShadowAmt, uHighAmt, uSoftAmt, uContrast, uHazeAmt, uVignette, uAspect;
        uniform vec3 uShadow, uHigh, uSoft, uHaze;
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
        vec3 softLight(vec3 b, vec3 s) {
          vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
          return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
        }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
          c = toSRGB(clamp(neutral(max(c, 0.0)), 0.0, 1.0));
          if (uEnabled > 0.5) {
            float l = luma(c);
            c = mix(vec3(l), c, uSat);
            // Split tone at constant brightness: the darkest tones lean one way, lit surfaces the
            // other. Whites are left alone, so wool and Pip's markings stay white in any light.
            float ws = 1.0 - smoothstep(0.04, 0.42, l);
            float wh = smoothstep(0.3, 0.75, l) * (1.0 - smoothstep(0.78, 0.97, l));
            c = mix(c, c * uShadow / max(luma(uShadow), 0.001), ws * uShadowAmt);
            c = mix(c, c * uHigh / max(luma(uHigh), 0.001), wh * uHighAmt);
            c = mix(c, softLight(clamp(c, 0.0, 1.0), uSoft), uSoftAmt);
            c = (c - 0.5) * uContrast + 0.5;
            // Haze over the far side of the valley, which sits at the top of the frame.
            c = mix(c, uHaze, uHazeAmt * smoothstep(0.52, 1.0, vUv.y));
            vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
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
    mc(a.soft, b.soft, u.uSoft.value);
    u.uSoftAmt.value = m(a.softAmt, b.softAmt);
    u.uContrast.value = m(a.contrast, b.contrast);
    mc(a.haze, b.haze, u.uHaze.value);
    u.uHazeAmt.value = m(a.hazeAmt, b.hazeAmt) * this.hazeScale;
    u.uVignette.value = m(a.vignette, b.vignette);
  }

  /** Draw the graded image to the screen. */
  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
