import * as THREE from 'three';
import { clamp } from '../game/math';

// Colour grade as a post-process pass. The scene renders linear HDR into a multisampled
// half-float target; this pass tone maps it (Khronos PBR Neutral) and grades it.
//
// The lights carry the evening (gold key, then a coral-pink one against a cool violet sky fill,
// then the moon); the grade supports them without painting over the materials. Blending green
// towards rose or violet in RGB passes through grey (they are opposite hues), so the grade works
// in OKLCH (lightness, chroma, hue): each pixel keeps its lightness, and its hue turns part of the
// way towards the phase's colour for its tone (shadows, midtones, highlights) along the colour
// wheel, with the chroma eased towards the phase's own:
//   gold      untouched grass, cool blue shadows, cream highlights
//   sunset    lit grass coral-rose, shaded grass violet, other materials mostly their own
//   twilight  colour fading from the ground: mauve in the moonlight, indigo in the shade
//   night     violet-indigo ground and shadows, silver moonlit tops, warm windows
// Strongly saturated signal colours (the wolves' danger ring and outline, Pip's marker, lamp
// light at night) are measured before any grading and keep their own colour, so a threat or a
// lit window reads the same all evening, and the animals (marked in the target's alpha) keep
// most of theirs.
// Then contrast around a per-phase pivot, a haze band over the far valley at the top of the
// frame, a glow on the side the sun or moon is on, and a vignette.

/**
 * A tone zone's target: OKLCH hue in degrees, chroma (at lightness 0.62; darker pixels get
 * proportionally less, so shadows never turn neon), and how far the zone moves towards it.
 */
type Zone = [hue: number, chroma: number, amount: number];

interface GradeKey {
  t: number;
  /** Chroma scale before the zones (1 = untouched). */
  sat: number;
  /**
   * OKLab lightness bands: shadows fade out between the first two values, highlights fade in
   * between the last two (a dusk frame is darker overall, so its bands sit lower).
   */
  zones: [number, number, number, number];
  /**
   * How much colours other than the grass family (yellow-green) are spared from the zones: the
   * stream keeps some of its own cool hue against the rose ground (0 = every hue turns alike).
   */
  spare: number;
  /**
   * Once the sun is down, warm light can only be lamps and windows: warm-hued pixels keep their
   * colour by this much, so the lamp pools glow orange against the violet night.
   */
  warm: number;
  shadow: Zone;
  mid: Zone;
  high: Zone;
  /** OKLCH chroma above which a pixel is a signal colour and keeps its own hue. */
  protect: number;
  /** Exposure multiplier on top of the lighting's own. */
  gain: number;
  contrast: number;
  /** Brightness the contrast pivots on: low at dusk and night, or it crushes a dark frame to black. */
  pivot: number;
  haze: string;
  hazeAmt: number;
  vignette: number;
}

const KEYS: GradeKey[] = [
  // Golden hour: the lights carry it; the grade only cools the shadows and creams the whites.
  { t: 0.0, sat: 0.8, zones: [0.34, 0.5, 0.7, 0.86], spare: 0.55, warm: 0, shadow: [255, 0.06, 0.3], mid: [100, 0.11, 0], high: [75, 0.05, 0.2], protect: 0.2, gain: 1.0, contrast: 1.38, pivot: 0.42, haze: '#ffd9a0', hazeAmt: 0.24, vignette: 0.16 },
  { t: 0.3, sat: 0.82, zones: [0.34, 0.5, 0.7, 0.86], spare: 0.55, warm: 0, shadow: [262, 0.06, 0.35], mid: [85, 0.11, 0.1], high: [65, 0.06, 0.25], protect: 0.2, gain: 1.02, contrast: 1.38, pivot: 0.42, haze: '#ffc88c', hazeAmt: 0.26, vignette: 0.18 },
  // Sunset, as the wolves come out. The low light rakes across the hills: grass brighter than
  // the valley's average (slopes facing the sun) turns coral-rose, grass darker than it (shade,
  // slopes facing away) turns cool violet, the flats between read rose. Other materials (path,
  // stone, water, trees) keep most of their own colour; the pink key light is on the whites.
  { t: 0.45, sat: 0.95, zones: [0.4, 0.56, 0.72, 0.88], spare: 0.7, warm: 0, shadow: [290, 0.08, 0.68], mid: [18, 0.08, 0.62], high: [8, 0.05, 0.4], protect: 0.17, gain: 1.06, contrast: 1.34, pivot: 0.38, haze: '#ffa98c', hazeAmt: 0.32, vignette: 0.2 },
  { t: 0.6, sat: 0.95, zones: [0.38, 0.54, 0.7, 0.86], spare: 0.7, warm: 0, shadow: [292, 0.08, 0.7], mid: [8, 0.075, 0.66], high: [2, 0.05, 0.42], protect: 0.16, gain: 1.06, contrast: 1.34, pivot: 0.34, haze: '#e896a8', hazeAmt: 0.32, vignette: 0.24 },
  // Twilight under the rising moon, closing in: the ground's own colour fades (as it does to the
  // eye in low light), moonlit ground mauve, shade indigo, silver tops; the frame darkens.
  { t: 0.74, sat: 0.45, zones: [0.3, 0.44, 0.62, 0.8], spare: 0.4, warm: 0.8, shadow: [308, 0.075, 0.75], mid: [324, 0.065, 0.72], high: [300, 0.035, 0.45], protect: 0.13, gain: 0.98, contrast: 1.36, pivot: 0.24, haze: '#b87ab0', hazeAmt: 0.26, vignette: 0.32 },
  { t: 0.88, sat: 0.35, zones: [0.26, 0.4, 0.58, 0.78], spare: 0.25, warm: 1, shadow: [302, 0.075, 0.76], mid: [312, 0.062, 0.74], high: [292, 0.03, 0.45], protect: 0.12, gain: 0.9, contrast: 1.36, pivot: 0.2, haze: '#7a5aa4', hazeAmt: 0.22, vignette: 0.38 },
  // Night: violet-indigo ground, deeper indigo shade, silver moonlit tops, warm windows.
  { t: 1.0, sat: 0.3, zones: [0.24, 0.38, 0.56, 0.76], spare: 0.15, warm: 1, shadow: [296, 0.07, 0.78], mid: [304, 0.06, 0.76], high: [285, 0.03, 0.45], protect: 0.11, gain: 0.84, contrast: 1.36, pivot: 0.18, haze: '#383c80', hazeAmt: 0.18, vignette: 0.44 },
];

/** Display-space (sRGB) components of a hex colour. */
function srgb(hex: string, out = new THREE.Vector3()) {
  const n = parseInt(hex.slice(1), 16);
  return out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const DEG = Math.PI / 180;

/** Interpolate a zone: hue the short way round the wheel (never through grey), chroma and amount linearly. */
function mixZone(a: Zone, b: Zone, s: number, out: THREE.Vector3) {
  let dh = b[0] - a[0];
  dh = ((((dh + 180) % 360) + 360) % 360) - 180;
  return out.set((a[0] + dh * s) * DEG, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s);
}

export class GradePass {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Look-dev switch: false shows the tone-mapped render without the grade. */
  enabled = true;
  /** The haze band suits the top-down play camera; the title's low shot shows the real sky. */
  hazeScale = 1;
  /** Display-space sky colour the haze leans towards (set from the mood's horizon each frame). */
  hazeSky: THREE.Vector3 | null = null;

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
        uZones: { value: new THREE.Vector4(0.34, 0.5, 0.7, 0.86) },
        uShadowZ: { value: new THREE.Vector3() },
        uMidZ: { value: new THREE.Vector3() },
        uHighZ: { value: new THREE.Vector3() },
        uProtect: { value: 0.2 },
        uSpare: { value: 0.5 },
        uWarm: { value: 0 },
        uGain: { value: 1 },
        uContrast: { value: 1 },
        uPivot: { value: 0.4 },
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
        uniform float uExposure, uEnabled, uSat, uProtect, uSpare, uWarm, uGain, uContrast, uPivot, uHazeAmt, uVignette, uAspect;
        uniform vec3 uShadowZ, uMidZ, uHighZ, uHaze, uSunGlow;
        uniform vec4 uZones;
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
        // OKLab (Bjorn Ottosson), from and to linear sRGB.
        vec3 toOklab(vec3 c) {
          vec3 lms = vec3(
            0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
            0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
            0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
          lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
          return vec3(
            0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
            1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
            0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
        }
        vec3 fromOklab(vec3 lab) {
          vec3 lms = vec3(
            lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
            lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
            lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
          lms = lms * lms * lms;
          return vec3(
            4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
            -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
            -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
        }
        // Turn a colour (hue h, chroma c) towards a zone's target: along the wheel for the hue,
        // straight for the chroma. A near-grey pixel has no hue of its own and takes the zone's.
        vec2 toward(float h, float c, float l, float k, vec3 z) {
          float own = smoothstep(0.012, 0.045, c);
          float a = z.z * k;
          float dh = z.x - h;
          dh = atan(sin(dh), cos(dh));
          float h2 = h + dh * mix(1.0, a, own);
          // Near-grey pixels (stone, fleece, fence) only take a little of the zone's colour.
          float c2 = mix(c, z.y * clamp(l / 0.62, 0.35, 1.25), a * (0.35 + 0.65 * own));
          return c2 * vec2(cos(h2), sin(h2));
        }
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          vec3 c = src.rgb * uExposure * (uEnabled > 0.5 ? uGain : 1.0);
          // Characters write alpha 0 (see actors.ts). Trees faded by alpha-to-coverage resolve to
          // 0.75 or more, so they never count.
          float character = 1.0 - smoothstep(0.1, 0.7, src.a);
          c = clamp(neutral(max(c, 0.0)), 0.0, 1.0);
          if (uEnabled > 0.5) {
            vec3 lab = toOklab(c);
            float chroma = length(lab.yz);
            float hue = atan(lab.z, lab.y);
            float cs = chroma * uSat;
            // Tone zones by perceptual lightness: shadows, midtones (lit grass), highlights.
            float wS = 1.0 - smoothstep(uZones.x, uZones.y, lab.x);
            float wH = smoothstep(uZones.z, uZones.w, lab.x);
            float wM = max(0.0, 1.0 - wS - wH);
            // The grass family (yellow through green, OKLCH hue about 60-170) turns fully; other
            // hues (the stream, stone) partly, so the valley keeps some of its own colours.
            float fromGrass = abs(atan(sin(hue - 1.99), cos(hue - 1.99)));
            float k = 1.0 - uSpare * smoothstep(1.0, 1.6, fromGrass) * smoothstep(0.012, 0.045, cs);
            vec2 ab = wS * toward(hue, cs, lab.x, k, uShadowZ) + wM * toward(hue, cs, lab.x, k, uMidZ) + wH * toward(hue, cs, lab.x, k, uHighZ);
            // Signal colours keep their own; the animals keep most of theirs, so they stand out
            // from the ground by colour as well as by outline.
            // Lamp light after sunset: orange-yellow hues (OKLCH about 40-100 degrees) with some colour.
            float lamp = uWarm * smoothstep(0.035, 0.07, chroma) * (1.0 - smoothstep(0.45, 0.8, abs(atan(sin(hue - 1.22), cos(hue - 1.22)))));
            ab = mix(ab, lab.yz, max(max(smoothstep(uProtect, uProtect + 0.05, chroma), character * 0.7), lamp));
            c = clamp(fromOklab(vec3(lab.x, ab)), 0.0, 1.0);
          }
          c = toSRGB(c);
          if (uEnabled > 0.5) {
            // Contrast around the phase's own pivot: highlights brighten while shadows deepen,
            // without crushing a dusk or night frame to black.
            c = (c - uPivot) * uContrast + uPivot;
            // Sky-coloured haze over the far third of the valley (peach, then rose, then violet): the
            // sky the herding camera cannot show, as the air it lights.
            c = mix(c, uHaze, uHazeAmt * smoothstep(0.6, 1.0, vUv.y));
            vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
            // A soft glow on the side of the frame the sun (or moon) is on.
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
    u.uZones.value.set(m(a.zones[0], b.zones[0]), m(a.zones[1], b.zones[1]), m(a.zones[2], b.zones[2]), m(a.zones[3], b.zones[3]));
    mixZone(a.shadow, b.shadow, s, u.uShadowZ.value);
    mixZone(a.mid, b.mid, s, u.uMidZ.value);
    mixZone(a.high, b.high, s, u.uHighZ.value);
    u.uProtect.value = m(a.protect, b.protect);
    u.uSpare.value = m(a.spare, b.spare);
    u.uWarm.value = m(a.warm, b.warm);
    u.uGain.value = m(a.gain, b.gain);
    u.uContrast.value = m(a.contrast, b.contrast);
    u.uPivot.value = m(a.pivot, b.pivot);
    mc(a.haze, b.haze, u.uHaze.value);
    if (this.hazeSky) u.uHaze.value.lerp(this.hazeSky, 0.6);
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
