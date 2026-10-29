import type { Scene } from '@babylonjs/core/scene';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/*
 * Small hand-written GLSL ES 1.00 shaders (WebGL1-safe; Babylon upgrades them for WebGL2). They share
 * the scene's sun direction, a clock, and Babylon's linear fog uniforms.
 */

/** Direction towards the sun: high, behind the camera's right shoulder, so fronts of things are lit. */
export const SUN_DIR = new Vector3(0.5, 0.8, -0.6).normalize();
/** Fog colour: a warm peach haze where the far meadow fades out. */
export const HORIZON = '#FFD9B8';
/** Soft sky blue, reflected in the pond. */
export const ZENITH = '#9FD3FF';
/** Wind: unit direction on the ground (x, z). Clouds drift and trees sway along it. */
export const WIND_X = 0.96;
export const WIND_Z = 0.28;

/**
 * The clock wraps every 20π s. Every animation runs at a multiple of 0.1 rad/s (or a whole number of
 * cycles per period), so the wrap is seamless.
 */
export const CLOCK_PERIOD = 20 * Math.PI;
/**
 * Seconds of rendering in x, which every shader reads by reference (a vector, because Babylon shares
 * vectors but not plain numbers between materials; y is unused).
 */
export const CLOCK = new Vector2(0, 0);

const glsl = (hex: string): string => {
  const c = Color3.FromHexString(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const vec3 = (v: Vector3): string => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

/** Vertex prelude: plain or instanced world matrix, fog depth and world position out. */
const VERTEX_HEAD = `precision highp float;
attribute vec3 position;
#ifdef INSTANCES
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;
#else
uniform mat4 world;
#endif
uniform mat4 view;
uniform mat4 viewProjection;
uniform vec2 clock;
varying vec3 vPosW;
varying float vDepth;
mat4 worldMatrix() {
#ifdef INSTANCES
  return mat4(world0, world1, world2, world3);
#else
  return world;
#endif
}
`;

/** Fragment prelude: the sun, the sunlit tint and Babylon's linear fog (start = vFogInfos.y, end = vFogInfos.z). */
const FRAGMENT_HEAD = `precision highp float;
uniform vec4 vFogInfos;
uniform vec3 vFogColor;
uniform vec3 cameraPosition;
uniform vec2 clock;
varying vec3 vPosW;
varying float vDepth;
const vec3 SUN = ${vec3(SUN_DIR)};
/** The warm tint of sunlit, up-facing surfaces. */
const vec3 SUNLIT = vec3(1.0, 0.96, 0.9);
vec3 fog(vec3 c) {
  float f = clamp((vFogInfos.z - vDepth) / max(vFogInfos.z - vFogInfos.y, 0.001), 0.0, 1.0);
  return mix(vFogColor, c, f);
}
`;

interface ShaderOptions {
  attributes?: string[];
  uniforms?: string[];
  samplers?: string[];
  defines?: string[];
  alpha?: boolean;
}

/** A ShaderMaterial from the shared preludes plus `vertex` / `fragment` bodies. */
function shader(name: string, scene: Scene, vertex: string, fragment: string, o: ShaderOptions = {}): ShaderMaterial {
  const m = new ShaderMaterial(
    name,
    scene,
    { vertexSource: VERTEX_HEAD + vertex, fragmentSource: FRAGMENT_HEAD + fragment },
    {
      attributes: ['position', ...(o.attributes ?? [])],
      uniforms: ['world', 'view', 'viewProjection', 'cameraPosition', 'vFogInfos', 'vFogColor', 'clock', ...(o.uniforms ?? [])],
      samplers: o.samplers ?? [],
      defines: o.defines ?? [],
      needAlphaBlending: o.alpha === true,
    },
  );
  m.setVector2('clock', CLOCK);
  return m;
}

/** For flat ground meshes: world position, fog depth and the mesh's uv. */
const FLAT_VERTEX = `attribute vec2 uv;
varying vec2 vUv;
void main() {
  vec4 p = worldMatrix() * vec4(position, 1.0);
  vPosW = p.xyz;
  vUv = uv;
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`;

/** Soft blurred-disc cloud shadow on a unit ground quad (uv 0..1), one instance per cloud. */
export function cloudShadowMaterial(scene: Scene): ShaderMaterial {
  const m = shader(
    'cloudShadow',
    scene,
    FLAT_VERTEX,
    `varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * 0.15;
  gl_FragColor = vec4(vec3(0.24, 0.27, 0.4), a);
}`,
    { attributes: ['uv'], alpha: true },
  );
  m.disableDepthWrite = true;
  return m;
}

/**
 * Soft toon shading: three gentle bands (deep shade, mid, warm sunlit), and one subtle warm rim
 * that lifts silhouettes off the grass. Up-facing surfaces show `hex` itself. Vertex colours, if the
 * mesh has them, tint it. Works for plain meshes, clones and instances. Variants:
 * - `sway`: foliage bends in the wind, more the higher it is above 1.5 m (trunks are a separate mesh),
 *   each tree phased by where it stands.
 * - `shimmer`: colours drift towards their rotated neighbours (r→g→b) and back, phased per instance.
 * - `cloud`: fades out within 15-35 m of the camera (drawn after a depth pre-pass, so a half-faded
 *   cloud shows only its front, not its inner puffs).
 */
export function toonMaterial(
  name: string,
  hex: string,
  scene: Scene,
  variant: 'sway' | 'shimmer' | 'cloud' | null = null,
): ShaderMaterial {
  const m = shader(
    name,
    scene,
    `attribute vec3 normal;
#ifdef VERTEXCOLOR
attribute vec4 color;
varying vec3 vColor;
#endif
#ifdef SHIMMER
varying float vPhase;
#endif
varying vec3 vNormalW;
void main() {
  mat4 w = worldMatrix();
  vec4 p = w * vec4(position, 1.0);
#ifdef SWAY
  // A slowly varying phase: trees metres apart sway apart, one canopy (a few metres) barely bends.
  float ph = dot(p.xz, vec2(0.09, 0.06));
  float h = max(p.y - 1.5, 0.0);
  p.xz += vec2(${WIND_X.toFixed(3)}, ${WIND_Z.toFixed(3)}) * (sin(clock.x * 1.7 + ph) + 0.35 * sin(clock.x * 3.9 + ph * 2.3 + 1.0)) * h * 0.05;
#endif
#ifdef SHIMMER
  vPhase = dot(w[3].xz, vec2(0.31, 0.17));
#endif
#ifdef VERTEXCOLOR
  vColor = color.rgb;
#endif
  vPosW = p.xyz;
  vNormalW = normalize((w * vec4(normal, 0.0)).xyz);
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`,
    `uniform vec3 tint;
#ifdef VERTEXCOLOR
varying vec3 vColor;
#endif
#ifdef SHIMMER
varying float vPhase;
#endif
varying vec3 vNormalW;
void main() {
  vec3 n = normalize(vNormalW);
  float hl = dot(n, SUN) * 0.5 + 0.5;
  vec3 base = tint;
#ifdef VERTEXCOLOR
  base *= vColor;
#endif
#ifdef SHIMMER
  base = mix(base, base.gbr, 0.5 + 0.5 * sin(clock.x * 0.7 + vPhase));
#endif
  // Shaded bands deepen towards a richer version of the colour (painterly, keeps it saturated).
  vec3 shade = base * mix(vec3(0.7, 0.7, 0.84), base, 0.35);
  vec3 mid = base * mix(vec3(0.88, 0.88, 0.95), base, 0.15);
  vec3 c = mix(shade, mid, smoothstep(0.4, 0.47, hl));
  c = mix(c, base * SUNLIT, smoothstep(0.7, 0.76, hl));
  float r = 1.0 - max(dot(n, normalize(cameraPosition - vPosW)), 0.0);
  r *= r;
  c = mix(c, vec3(1.0, 0.96, 0.88), r * r * 0.12);
#ifdef FADE
  gl_FragColor = vec4(fog(c), smoothstep(15.0, 35.0, vDepth));
#else
  gl_FragColor = vec4(fog(c), 1.0);
#endif
}`,
    {
      attributes: ['normal'],
      uniforms: ['tint'],
      defines: variant === 'sway' ? ['SWAY'] : variant === 'shimmer' ? ['SHIMMER'] : variant === 'cloud' ? ['FADE'] : [],
      alpha: variant === 'cloud',
    },
  );
  m.setColor3('tint', Color3.FromHexString(hex));
  m.needDepthPrePass = variant === 'cloud';
  return m;
}

/**
 * A 64 × 64 tiling texture of smooth random values (the same in every channel): the grass and the
 * road read their noise from it, one cheap filtered fetch each instead of maths per pixel.
 */
export function noiseTexture(scene: Scene): RawTexture {
  const N = 64;
  let a = new Float32Array(N * N);
  let seed = 12345;
  for (let i = 0; i < a.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    a[i] = (seed >>> 8) / 16777216;
  }
  // Two wrapping 3 × 3 blurs soften the blocks into blotches.
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) sum += a[((y + dy + N) % N) * N + ((x + dx + N) % N)];
        b[y * N + x] = sum / 9;
      }
    a = b;
  }
  // Stretch back to the full 0..1 range.
  let lo = 1, hi = 0;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const bytes = new Uint8Array(N * N * 4);
  for (let i = 0; i < a.length; i++) bytes.fill(Math.round(((a[i] - lo) / (hi - lo)) * 255), i * 4, i * 4 + 4);
  const t = RawTexture.CreateRGBATexture(bytes, N, N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** Grass: big soft patches of colour, some a touch sunnier. Flat and up-facing, lit by the sun. */
export function grassMaterial(hex: string, noise: Texture, scene: Scene): ShaderMaterial {
  const m = shader(
    'grass',
    scene,
    FLAT_VERTEX,
    `uniform sampler2D noise;
uniform vec3 tint;
void main() {
  float n = texture2D(noise, vPosW.xz / 300.0).r;
  vec3 c = tint * SUNLIT * (0.95 + 0.1 * n);
  c = mix(c, c * vec3(1.04, 1.02, 0.9), smoothstep(0.6, 0.9, n) * 0.4);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'], uniforms: ['tint'], samplers: ['noise'] },
  );
  m.setColor3('tint', Color3.FromHexString(hex));
  m.setTexture('noise', noise);
  return m;
}

/**
 * Road: fine speckle, slightly darker edges (the ribbon's uv.y runs 0 → 1 across the road) and two
 * faint tyre-worn lanes where the karts drive.
 */
export function roadMaterial(hex: string, noise: Texture, scene: Scene): ShaderMaterial {
  const m = shader(
    'road',
    scene,
    FLAT_VERTEX,
    `uniform sampler2D noise;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  float e = abs(vUv.y - 0.5) * 2.0;
  float n = texture2D(noise, vPosW.xz / 2.5).r;
  vec3 c = tint * SUNLIT;
  c *= 1.0 + 0.035 * smoothstep(0.68, 0.85, n) - 0.03 * smoothstep(0.32, 0.15, n);
  c *= 1.0 - 0.1 * smoothstep(0.75, 1.0, e);
  float lane = (e - 0.5) / 0.09;
  c *= 1.0 - 0.035 * exp(-lane * lane);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'], uniforms: ['tint'], samplers: ['noise'] },
  );
  m.setColor3('tint', Color3.FromHexString(hex));
  m.setTexture('noise', noise);
  return m;
}

/**
 * Boost pad: a pale butter pad whose warm chevrons scroll forward along the road and gently pulse.
 * The pad's uv is (metres along the road, metres across); chevron arms sweep back by `sweep` per metre
 * across, repeat every `spacing` metres and fill `depth` of it; they fade out before the pad's ends.
 */
export function padMaterial(
  base: string,
  arrow: string,
  pad: { halfLength: number; halfWidth: number; spacing: number; depth: number; sweep: number },
  scene: Scene,
): ShaderMaterial {
  const f = (v: number): string => v.toFixed(6);
  // About 1.4 chevrons a second, a whole number of them per clock period.
  const scroll = 88 / CLOCK_PERIOD;
  return shader(
    'boostPad',
    scene,
    FLAT_VERTEX,
    `varying vec2 vUv;
void main() {
  float across = abs(vUv.y);
  float u = fract((vUv.x + across * ${f(pad.sweep)}) / ${f(pad.spacing)} - clock.x * ${f(scroll)});
  float stripe = smoothstep(0.0, 0.06, u) - smoothstep(${f(pad.depth)}, ${f(pad.depth + 0.06)}, u);
  float inside = (1.0 - smoothstep(${f(pad.halfWidth - 0.15)}, ${f(pad.halfWidth)}, across))
    * (1.0 - smoothstep(${f(pad.halfLength - 0.6)}, ${f(pad.halfLength - 0.1)}, abs(vUv.x)));
  float pulse = 0.5 + 0.5 * sin(clock.x * 4.0);
  vec3 c = mix(${glsl(base)} * (0.97 + 0.05 * pulse), ${glsl(arrow)} * (0.94 + 0.1 * pulse), stripe * inside);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'] },
  );
}

/**
 * A round pond around (x, z): water out to `radius` (deeper teal in the middle, the sky reflected at
 * grazing angles, gentle travelling ripples), then a ring of sand that fades into the grass by `outer`.
 */
export function pondMaterial(x: number, z: number, radius: number, outer: number, scene: Scene): ShaderMaterial {
  const m = shader(
    'pond',
    scene,
    FLAT_VERTEX,
    `uniform vec4 pond;
const vec3 HORIZON = ${glsl(HORIZON)};
const vec3 ZENITH = ${glsl(ZENITH)};
void main() {
  vec2 d = vPosW.xz - pond.xy;
  float dist = length(d);
  float e = dist - pond.z;
  float t = clock.x;
  // Ripples: rings drifting out from the middle plus a slow cross swell, as a tilted normal.
  vec2 grad = d / max(dist, 0.001) * cos(dist * 2.2 - t * 1.2) * 0.05
    + vec2(cos(vPosW.x * 1.3 + vPosW.z * 0.4 + t * 0.9), cos(vPosW.z * 1.1 - vPosW.x * 0.3 - t * 0.7)) * 0.05;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 sky = mix(HORIZON, ZENITH, clamp(reflect(-v, n).y, 0.0, 1.0));
  vec3 water = mix(vec3(0.4, 0.68, 0.8), vec3(0.62, 0.85, 0.86), smoothstep(-pond.z * 0.7, 0.0, e));
  float fres = 1.0 - max(dot(n, v), 0.0);
  water = mix(water, sky, 0.2 + 0.5 * fres * fres * fres);
  water = mix(water, vec3(0.86, 0.95, 0.94), smoothstep(-0.5, 0.0, e) * 0.3);
  vec3 sand = mix(vec3(0.85, 0.77, 0.61), vec3(0.96, 0.9, 0.77), smoothstep(0.0, 0.5, e));
  vec3 c = mix(water, sand, smoothstep(-0.08, 0.08, e));
  gl_FragColor = vec4(fog(c), 1.0 - smoothstep(pond.w - pond.z - 0.7, pond.w - pond.z, e));
}`,
    { attributes: ['uv'], uniforms: ['pond'], alpha: true },
  );
  m.setVector4('pond', new Vector4(x, z, radius, outer));
  return m;
}
