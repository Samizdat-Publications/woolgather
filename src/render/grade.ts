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
//   sunset    green grass under apricot then rose light, blue-violet shade, pink whites
//   twilight  colour draining from the ground towards blue-grey, violet shade, silver tops
//   night     blue-silver moonlit ground, violet-indigo shade, warm lamps and windows
// Strongly saturated signal colours (the wolves' danger ring and outline, Pip's marker, lamp
// light at night) are measured before any grading and keep their own colour, so a threat or a
// lit window reads the same all evening, and the animals (marked in the target's alpha) keep
// most of theirs.
// Then contrast around a per-phase pivot, a haze band over the far valley at the top of the
// frame, the sky's own colour along the top edge (the horizon just out of shot), soft light
// shafts slanting in from a low sun, a glow on the side the sun or moon is on, and a vignette.
// Before all that, a bloom: the brightest things (sunlit fleece, glints, lamps and windows) glow.

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
   * between the last two (a dusk frame is darker overall, so its bands sit lower). The shadow
   * band is wide: open ground whose lightness sits near a narrow band's edge flipped between
   * the shade's hue and the light's in large blotches.
   */
  zones: [number, number, number, number];
  /**
   * How much colours other than the grass family (yellow-green) are spared from the zones: the
   * stream keeps some of its own cool hue against the rose ground (0 = every hue turns alike).
   */
  spare: number;
  /**
   * How much of its own colour shade keeps before it takes the shadow hue: shade is lit by the
   * sky, not the sun, so at sunset olive grass in shadow turns violet instead of passing through
   * red and brown on the way.
   */
  shadeKeep: number;
  /** How far near-grey things (stone, fleece, fences) are kept out of the zone colours: fully in
   * daylight, hardly at all after dark, when every colour has faded. */
  greyKeep: number;
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
  /** The sky's colour screened along the top edge of the frame, as if the horizon were just above it. */
  sky: number;
  /** Light shafts from a low sun (0 once it has set). */
  shafts: number;
  /** Bloom strength, and the linear brightness where it starts (lower at night, so the moonlit fleece and lamps glow). */
  bloom: number;
  bloomAt: number;
  vignette: number;
}

const KEYS: GradeKey[] = [
  // Golden hour: the gold is in the light (a strong amber key), the grass under it a warm green
  // nudged a little towards gold, a soft blue-violet shade, cream highlights, a clear view and the
  // warm sky along the top edge.
  { t: 0.0, sat: 0.86, zones: [0.36, 0.62, 0.74, 0.9], greyKeep: 1, shadeKeep: 0.5, spare: 0.55, warm: 0, shadow: [262, 0.065, 0.62], mid: [96, 0.105, 0.14], high: [78, 0.06, 0.3], protect: 0.2, gain: 1.16, contrast: 1.4, pivot: 0.42, haze: '#ffd9a0', hazeAmt: 0.07, sky: 0.36, shafts: 0.12, bloom: 0.3, bloomAt: 0.95, vignette: 0.16 },
  { t: 0.3, sat: 0.86, zones: [0.36, 0.62, 0.74, 0.9], greyKeep: 1, shadeKeep: 0.5, spare: 0.55, warm: 0, shadow: [266, 0.07, 0.65], mid: [90, 0.105, 0.18], high: [65, 0.065, 0.32], protect: 0.2, gain: 1.14, contrast: 1.4, pivot: 0.42, haze: '#ffc88c', hazeAmt: 0.09, sky: 0.4, shafts: 0.13, bloom: 0.32, bloomAt: 0.92, vignette: 0.18 },
  // Sunset, as the wolves come out: told by the light, not by repainting the ground. The grass
  // stays green, cooler and duller as the sun sinks (apricot, then rose, over a cool sky fill);
  // the shade turns blue-violet, well apart in hue from the warm light; the pink is on the
  // fleece, stone and path; the haze and the stream carry the sky's rose.
  { t: 0.45, sat: 0.9, zones: [0.34, 0.6, 0.72, 0.88], greyKeep: 1, shadeKeep: 0.25, spare: 0.8, warm: 0, shadow: [290, 0.11, 0.78], mid: [95, 0.1, 0], high: [10, 0.045, 0.35], protect: 0.17, gain: 1.1, contrast: 1.3, pivot: 0.38, haze: '#ffa98c', hazeAmt: 0.16, sky: 0.55, shafts: 0.14, bloom: 0.36, bloomAt: 0.88, vignette: 0.2 },
  { t: 0.6, sat: 0.85, zones: [0.32, 0.58, 0.7, 0.86], greyKeep: 1, shadeKeep: 0.25, spare: 0.8, warm: 0, shadow: [294, 0.11, 0.8], mid: [100, 0.1, 0], high: [4, 0.045, 0.4], protect: 0.16, gain: 1.08, contrast: 1.3, pivot: 0.34, haze: '#e896a8', hazeAmt: 0.16, sky: 0.55, shafts: 0.11, bloom: 0.36, bloomAt: 0.85, vignette: 0.24 },
  // Twilight under the rising moon, closing in: the colour drains from the ground (as it does to
  // the eye in low light) towards a cool blue-grey, the shade violet, the moonlit tops silver, and
  // the frame darker every second.
  { t: 0.74, sat: 0.35, zones: [0.2, 0.5, 0.62, 0.8], greyKeep: 0.35, shadeKeep: 0.3, spare: 0.6, warm: 0.8, shadow: [302, 0.11, 0.8], mid: [296, 0.085, 0.7], high: [280, 0.035, 0.45], protect: 0.13, gain: 1.04, contrast: 1.44, pivot: 0.26, haze: '#b87ab0', hazeAmt: 0.14, sky: 0.44, shafts: 0.02, bloom: 0.36, bloomAt: 0.72, vignette: 0.32 },
  { t: 0.88, sat: 0.32, zones: [0.18, 0.46, 0.58, 0.78], greyKeep: 0.3, shadeKeep: 0.3, spare: 0.5, warm: 1, shadow: [300, 0.115, 0.82], mid: [284, 0.095, 0.75], high: [270, 0.04, 0.5], protect: 0.12, gain: 0.98, contrast: 1.54, pivot: 0.24, haze: '#7a5aa4', hazeAmt: 0.12, sky: 0.38, shafts: 0, bloom: 0.4, bloomAt: 0.62, vignette: 0.38 },
  // Night: the moonlit ground deep indigo-blue, the shade a darker violet-indigo (a hue apart, so
  // the moonlight reads as light and not a filter), silver-blue tops, the lamps and windows warm.
  { t: 1.0, sat: 0.3, zones: [0.16, 0.44, 0.56, 0.76], greyKeep: 0.25, shadeKeep: 0.3, spare: 0.4, warm: 1, shadow: [298, 0.12, 0.88], mid: [272, 0.11, 0.8], high: [255, 0.045, 0.55], protect: 0.11, gain: 0.88, contrast: 1.55, pivot: 0.26, haze: '#383c80', hazeAmt: 0.1, sky: 0.32, shafts: 0, bloom: 0.45, bloomAt: 0.55, vignette: 0.44 },
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

const PASS_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** A half-float target for the bloom chain (no depth, no multisampling). */
function bloomTarget() {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}

export class GradePass {
  readonly target: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  // Bloom: a bright pass at a quarter of the resolution, blurred there and again at an eighth.
  private bloomA = bloomTarget();
  private bloomB = bloomTarget();
  private bloomC = bloomTarget();
  private bloomD = bloomTarget();
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private bloomAmt = 0;
  private bloomAt = 1;
  /** Look-dev switch: false shows the tone-mapped render without the grade. */
  enabled = true;
  /** Bloom switched off (perf analysis and the low quality tier). */
  bloomOff = false;
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
        uShadeKeep: { value: 1 },
        uGreyKeep: { value: 1 },
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
        uSkyAmt: { value: 0 },
        uInset: { value: new THREE.Vector4() },
        uInsetOn: { value: 0 },
        uShaftAmt: { value: 0 },
        uTime: { value: 0 },
        tBloomA: { value: null },
        tBloomC: { value: null },
        uBloom: { value: 0 },
        uMist: { value: 0 },
        uMistCol: { value: new THREE.Vector3(0.8, 0.82, 0.85) },
        uMistCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uMistOff: { value: new THREE.Vector2() },
        uMistR: { value: 0.3 },
        uFlash: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure, uEnabled, uSat, uProtect, uSpare, uWarm, uShadeKeep, uGreyKeep, uGain, uContrast, uPivot, uHazeAmt, uVignette, uAspect;
        uniform vec3 uShadowZ, uMidZ, uHighZ, uHaze, uSunGlow;
        uniform vec4 uZones;
        uniform vec2 uSunDir2;
        uniform float uSunAmt, uSkyAmt, uShaftAmt, uTime, uBloom, uInsetOn;
        uniform vec4 uInset;
        uniform sampler2D tBloomA, tBloomC;
        uniform float uMist, uMistR, uFlash;
        uniform vec3 uMistCol;
        uniform vec2 uMistCenter, uMistOff;
        varying vec2 vUv;
        float mhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float mnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mhash(i), mhash(i + vec2(1.0, 0.0)), u.x), mix(mhash(i + vec2(0.0, 1.0)), mhash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

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
        // Move a colour (OKLab a, b) towards a zone's target colour, in a straight line: a colour
        // far round the wheel from the target fades through grey on the way instead of turning
        // through a third hue. (Turning along the wheel flipped direction between neighbouring
        // pixels whose hue sat near the target's opposite, and drew large pink patches beside blue
        // ones across the twilight grass.) Near-grey pixels (stone, fleece, fence) only take a
        // little of the zone's colour.
        vec2 toward(vec2 ab, float ownC, float l, float k, vec3 z) {
          // Greyness is judged on the pixel's own chroma (shade that has shed its colour on purpose
          // still takes the zone's).
          float own = smoothstep(0.012, 0.045, ownC);
          float a = z.z * k * mix(1.0, 0.35 + 0.65 * own, uGreyKeep);
          vec2 target = z.y * clamp(l / 0.62, 0.35, 1.25) * vec2(cos(z.x), sin(z.x));
          return mix(ab, target, a);
        }
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          vec3 c = src.rgb * uExposure * (uEnabled > 0.5 ? uGain : 1.0);
          // The glow of the brightest things, added as light before the tone mapping.
          c += (texture2D(tBloomA, vUv).rgb * 0.55 + texture2D(tBloomC, vUv).rgb * 0.45) * uBloom;
          // Characters write alpha 0 (see actors.ts). Trees faded by alpha-to-coverage resolve to
          // 0.75 or more, so they never count.
          float character = 1.0 - smoothstep(0.1, 0.7, src.a);
          c = clamp(neutral(max(c, 0.0)), 0.0, 1.0);
          if (uEnabled > 0.5) {
            vec3 lab = toOklab(c);
            float chroma = length(lab.yz);
            float hue = atan(lab.z, lab.y);
            // Lamp light after sunset: strongly coloured orange-yellow (OKLCH about 5-100 degrees).
            // Warm pixels too faint for lamp light (the pool's fringe, beige ground by the fold)
            // shed their colour before they take the evening's hue: turning orange towards violet
            // passes through pink, which drew a pink ring round the lamp pool and a pink patch
            // over the yard.
            float warmHue = 1.0 - smoothstep(0.45, 0.85, abs(atan(sin(hue - 0.9), cos(hue - 0.9))));
            float lampK = smoothstep(0.06, 0.15, chroma) * warmHue;
            float lamp = uWarm * lampK;
            float cs = chroma * uSat * (1.0 - 0.8 * uWarm * (warmHue - lampK));
            vec2 own = lab.yz * (cs / max(chroma, 1e-5));
            // Tone zones by perceptual lightness: shadows, midtones (lit grass), highlights.
            float wS = 1.0 - smoothstep(uZones.x, uZones.y, lab.x);
            float wH = smoothstep(uZones.z, uZones.w, lab.x);
            float wM = max(0.0, 1.0 - wS - wH);
            // The grass family (yellow through green, OKLCH hue about 60-170) turns fully; other
            // hues (the stream, stone) partly, so the valley keeps some of its own colours.
            // Blue (the stream) keeps its own colour by the phase's spare; everything else takes the
            // evening's colour (sparing every hue far from the grass left the heather neon magenta).
            float fromBlue = abs(atan(sin(hue - 4.4), cos(hue - 4.4)));
            float k = 1.0 - uSpare * (1.0 - smoothstep(0.55, 1.05, fromBlue)) * smoothstep(0.012, 0.045, cs);
            // Shade sheds its own colour before the shadow hue (so olive shade turns violet, not
            // brown); hues spared from the zones (the stream's blue) keep theirs, or dark water went
            // a colourless black.
            vec2 ab = wS * toward(own * mix(1.0, uShadeKeep, k), cs, lab.x, k, uShadowZ) + wM * toward(own, cs, lab.x, k, uMidZ) + wH * toward(own, cs, lab.x, k, uHighZ);
            // Signal colours keep their own; the animals keep most of theirs, so they stand out
            // from the ground by colour as well as by outline.
            ab = mix(ab, lab.yz, max(max(smoothstep(uProtect, uProtect + 0.05, chroma), character * 0.7), lamp));
            c = clamp(fromOklab(vec3(lab.x, ab)), 0.0, 1.0);
          }
          c = toSRGB(c);
          if (uEnabled > 0.5) {
            // Contrast around the phase's own pivot: highlights brighten while shadows deepen,
            // without crushing a dusk or night frame to black.
            c = (c - uPivot) * uContrast + uPivot;
            // The close-up inset is its own picture: the haze, sky, shafts, glow and vignette of the
            // main view stay off it.
            float free = 1.0 - uInsetOn * step(uInset.x, vUv.x) * step(vUv.x, uInset.z) * step(uInset.y, vUv.y) * step(vUv.y, uInset.w);
            // Sky-coloured haze over the far third of the valley (peach, then rose, then violet): the
            // sky the herding camera cannot show, as the air it lights. Screened on (it adds light)
            // rather than mixed: rose mixed into olive grass is brown, rose light over it is rose air.
            c = 1.0 - (1.0 - c) * (1.0 - uHaze * uHazeAmt * free * smoothstep(0.55, 1.0, vUv.y));
            vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
            float sunSide = smoothstep(0.15, 1.0, dot(v, uSunDir2));
            // The sky itself, just beyond the top of the frame: its colour glowing along the top
            // edge, warmest on the sun's side, as if the horizon were just out of shot.
            float band = smoothstep(0.7, 1.0, vUv.y);
            band *= sqrt(band);
            vec3 skyCol = mix(uHaze, uSunGlow, 0.55 * sunSide);
            c = 1.0 - (1.0 - c) * (1.0 - skyCol * uSkyAmt * free * band);
            // Light shafts from a low sun: soft parallel beams through the evening air, slanting in
            // from its side of the frame and drifting slowly.
            vec2 sd = uSunDir2;
            float across = dot(v, vec2(-sd.y, sd.x));
            float along = dot(v, sd);
            float wave = 0.5 * sin(across * 7.0 + uTime * 0.05) + 0.3 * sin(across * 13.0 - uTime * 0.08 + 1.7) + 0.2 * sin(across * 23.0 + uTime * 0.11 + 4.1);
            float beam = smoothstep(0.2, 0.8, wave) * smoothstep(-0.9, 0.6, along);
            c = 1.0 - (1.0 - c) * (1.0 - uSunGlow * uShaftAmt * free * beam);
            // A soft glow on the side of the frame the sun (or moon) is on.
            c = 1.0 - (1.0 - c) * (1.0 - uSunGlow * uSunAmt * free * sunSide);
            c *= 1.0 - uVignette * free * smoothstep(0.4, 1.1, length(v) * 1.15);
            // Mist: a soft veil that thickens away from Pip, in drifting banks anchored to the ground
            // (the offset follows the camera over the world), thin everywhere, thick past the radius.
            if (uMist > 0.001) {
              vec2 mv = (vUv - uMistCenter) * vec2(uAspect, 1.0);
              vec2 q = vec2(vUv.x * uAspect, vUv.y) * 2.2 + uMistOff;
              float bank = mnoise(q + vec2(uTime * 0.035, uTime * 0.012)) * 0.6 + mnoise(q * 2.3 - vec2(uTime * 0.05, 0.0)) * 0.4;
              float far = smoothstep(uMistR * 0.45, uMistR * 1.5, length(mv) + (bank - 0.5) * 0.22);
              float mist = uMist * (0.14 + 0.72 * far) * (0.8 + 0.4 * bank);
              // Never a solid wall: the ground and anything on it show through the far mist as shapes.
              c = mix(c, uMistCol, clamp(mist, 0.0, 0.8) * free);
            }
            // Lightning: the whole frame flashes cold white for an instant.
            c = 1.0 - (1.0 - c) * (1.0 - vec3(0.86, 0.9, 1.0) * uFlash * 0.75);
          }
          // A little dither so smooth gradients never band.
          c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(tri, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // Bright pass: the source averaged over 4x4 texels (four bilinear taps) at the grade's
    // exposure, keeping only what is brighter than the threshold (with a soft knee).
    this.brightMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: this.target.texture }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 }, uThresh: { value: 1 } },
      vertexShader: PASS_VERT,
      fragmentShader: `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        uniform float uScale, uThresh;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
            + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25 * uScale;
          float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(uThresh, uThresh * 1.7, l), 1.0);
        }`,
    });
    // Separable 9-tap Gaussian in five bilinear fetches (a zero direction is a plain downsample).
    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: PASS_VERT,
      fragmentShader: `
        uniform sampler2D tSrc;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
          c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
          c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.material.uniforms.tBloomA.value = this.bloomA.texture;
    this.material.uniforms.tBloomC.value = this.bloomC.texture;
  }

  /** Multisampling of the scene target (0 turns it off). */
  setSamples(n: number) {
    if (this.target.samples === n) return;
    this.target.samples = n;
    this.target.dispose();
  }

  setSize(w: number, h: number) {
    this.target.setSize(w, h);
    this.material.uniforms.uAspect.value = w / Math.max(1, h);
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.bloomC.setSize(Math.max(1, Math.round(qw / 2)), Math.max(1, Math.round(qh / 2)));
    this.bloomD.setSize(Math.max(1, Math.round(qw / 2)), Math.max(1, Math.round(qh / 2)));
    this.brightMat.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  }

  /** One fullscreen pass of `material` into `target`. */
  private pass(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  private blur(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, ping: THREE.WebGLRenderTarget) {
    const u = this.blurMat.uniforms;
    u.tSrc.value = src.texture;
    u.uDir.value.set(1 / src.width, 0);
    this.pass(renderer, this.blurMat, ping);
    u.tSrc.value = ping.texture;
    u.uDir.value.set(0, 1 / src.height);
    this.pass(renderer, this.blurMat, src);
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
    u.uShadeKeep.value = m(a.shadeKeep, b.shadeKeep);
    u.uGreyKeep.value = m(a.greyKeep, b.greyKeep);
    u.uWarm.value = m(a.warm, b.warm);
    u.uGain.value = m(a.gain, b.gain);
    u.uContrast.value = m(a.contrast, b.contrast);
    u.uPivot.value = m(a.pivot, b.pivot);
    mc(a.haze, b.haze, u.uHaze.value);
    if (this.hazeSky) u.uHaze.value.lerp(this.hazeSky, 0.6);
    u.uHazeAmt.value = m(a.hazeAmt, b.hazeAmt) * this.hazeScale;
    u.uSkyAmt.value = m(a.sky, b.sky) * this.hazeScale;
    u.uShaftAmt.value = m(a.shafts, b.shafts) * this.hazeScale;
    u.uVignette.value = m(a.vignette, b.vignette);
    this.bloomAmt = this.enabled && !this.bloomOff ? m(a.bloom, b.bloom) : 0;
    this.bloomAt = m(a.bloomAt, b.bloomAt);
    this.brightMat.uniforms.uScale.value = exposure * u.uGain.value;
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

  /** The close-up inset's rectangle in CSS pixels (null when it is not up). */
  /** Mist over the frame: amount, its colour (display space), Pip's place on screen (uv), a world offset for the drifting banks, and the clear radius (uv, height = 1). */
  setMist(amount: number, color: THREE.Color, cx: number, cy: number, ox: number, oy: number, radius: number) {
    const u = this.material.uniforms;
    u.uMist.value = this.enabled ? amount : 0;
    u.uMistCol.value.set(color.r, color.g, color.b);
    u.uMistCenter.value.set(cx, cy);
    u.uMistOff.value.set(ox, oy);
    u.uMistR.value = radius;
  }

  /** Lightning flash, 0..1. */
  setFlash(v: number) {
    this.material.uniforms.uFlash.value = v;
  }

  setInset(r: { x: number; y: number; w: number; h: number } | null) {
    const u = this.material.uniforms;
    u.uInsetOn.value = r ? 1 : 0;
    if (!r) return;
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    u.uInset.value.set(r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H);
  }

  /** Draw the graded image to the screen. */
  render(renderer: THREE.WebGLRenderer) {
    const u = this.material.uniforms;
    u.uTime.value = performance.now() / 1000;
    u.uBloom.value = this.bloomAmt;
    if (this.bloomAmt > 0) {
      this.brightMat.uniforms.uThresh.value = this.bloomAt;
      this.pass(renderer, this.brightMat, this.bloomA);
      this.blur(renderer, this.bloomA, this.bloomB);
      const b = this.blurMat.uniforms;
      b.tSrc.value = this.bloomA.texture;
      b.uDir.value.set(0, 0);
      this.pass(renderer, this.blurMat, this.bloomC);
      this.blur(renderer, this.bloomC, this.bloomD);
      this.blur(renderer, this.bloomC, this.bloomD);
    }
    this.pass(renderer, this.material, null);
  }
}
