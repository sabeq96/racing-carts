import type { Scene } from '@babylonjs/core/scene';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/*
 * Small hand-written GLSL ES 1.00 shaders (WebGL1-safe; Babylon upgrades them for WebGL2). They share
 * one golden-afternoon light set, baked in as constants, and Babylon's linear fog uniforms.
 */

/** Direction towards the sun: high, behind the camera's right shoulder, so fronts of things are lit. */
export const SUN_DIR = new Vector3(0.5, 0.8, -0.6).normalize();
/** Fog colour: a warm peach haze where the far meadow fades out. */
export const HORIZON = '#FFD9B8';
/** Wind: unit direction on the ground (x, z). Clouds drift and trees sway along it. */
export const WIND_X = 0.96;
export const WIND_Z = 0.28;
/** Soft sky blue, reflected in the pond. */
export const ZENITH = '#9FD3FF';

/**
 * Shared per-frame values every shader reads by reference (setting a component costs no allocation):
 * x = seconds of rendering, y/z = camera target (x, z), w = camera radius.
 */
export const ENV = new Vector4(0, 0, 0, 40);

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
uniform vec4 env;
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

/** Fragment prelude: the light set and Babylon's linear fog (start = vFogInfos.y, end = vFogInfos.z). */
const FRAGMENT_HEAD = `precision highp float;
uniform vec4 vFogInfos;
uniform vec3 vFogColor;
uniform vec3 cameraPosition;
uniform vec4 env;
varying vec3 vPosW;
varying float vDepth;
const vec3 SUN = ${vec3(SUN_DIR)};
const vec3 HORIZON = ${glsl(HORIZON)};
const vec3 ZENITH = ${glsl(ZENITH)};
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
      uniforms: ['world', 'view', 'viewProjection', 'cameraPosition', 'vFogInfos', 'vFogColor', 'env', ...(o.uniforms ?? [])],
      samplers: o.samplers ?? [],
      defines: o.defines ?? [],
      needAlphaBlending: o.alpha === true,
    },
  );
  m.setVector4('env', ENV);
  return m;
}

/** Puffy clouds: flat white with a soft lavender shade on the side away from the sun. */
export function cloudMaterial(scene: Scene): ShaderMaterial {
  return shader(
    'cloud',
    scene,
    `attribute vec3 normal;
varying vec3 vNormalW;
void main() {
  mat4 w = worldMatrix();
  vec4 p = w * vec4(position, 1.0);
  vPosW = p.xyz;
  vNormalW = normalize((w * vec4(normal, 0.0)).xyz);
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`,
    `varying vec3 vNormalW;
void main() {
  vec3 n = normalize(vNormalW);
  float hl = dot(n, SUN) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.87, 0.87, 0.96), vec3(1.0, 0.98, 0.95), smoothstep(0.3, 0.75, hl));
  c *= mix(0.94, 1.0, smoothstep(-0.6, 0.2, n.y));
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['normal'] },
  );
}

/** Soft blurred-disc cloud shadow on a unit ground quad (uv 0..1), one instance per cloud. */
export function cloudShadowMaterial(scene: Scene): ShaderMaterial {
  const m = shader(
    'cloudShadow',
    scene,
    `attribute vec2 uv;
varying vec2 vUv;
void main() {
  vec4 p = worldMatrix() * vec4(position, 1.0);
  vPosW = p.xyz;
  vUv = uv;
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`,
    `varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * 0.13;
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
 * - `sway`: foliage bends in the wind. The mesh's uv holds (phase, height where the foliage starts);
 *   the bend grows with height above that, so the bottom (and the trunk, a separate mesh) stays put.
 * - `shimmer`: a slow rainbow hue drift (luma kept, so pastels stay pastel), phased per instance by
 *   where it stands.
 */
export function toonMaterial(
  name: string,
  hex: string,
  scene: Scene,
  variant: 'sway' | 'shimmer' | null = null,
): ShaderMaterial {
  const m = shader(
    name,
    scene,
    `attribute vec3 normal;
#ifdef SWAY
attribute vec2 uv;
#endif
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
  float h = max(p.y - uv.y, 0.0);
  float t = env.x * 1.7 + uv.x;
  p.xz += vec2(${WIND_X.toFixed(3)}, ${WIND_Z.toFixed(3)}) * (sin(t) + 0.35 * sin(t * 2.3 + 1.0)) * h * 0.05;
#endif
#ifdef SHIMMER
  vPhase = dot(w[3].xz, vec2(0.31, 0.17)) + p.y * 0.6;
#endif
#ifdef VERTEXCOLOR
  vColor = color.rgb;
#endif
  vPosW = p.xyz;
  vNormalW = normalize((w * vec4(normal, 0.0)).xyz);
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`,
    `uniform vec3 color;
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
  vec3 base = color;
#ifdef VERTEXCOLOR
  base *= vColor;
#endif
#ifdef SHIMMER
  // Rotate the hue in YIQ space (brightness stays) and soften it: pastels drift round the rainbow.
  float a = env.x * 0.7 + vPhase;
  float ca = cos(a), sa = sin(a);
  float y = dot(base, vec3(0.299, 0.587, 0.114));
  float i = dot(base, vec3(0.596, -0.274, -0.322));
  float q = dot(base, vec3(0.211, -0.523, 0.312));
  vec2 iq = vec2(i * ca - q * sa, i * sa + q * ca) * 0.55;
  y = y * 0.9 + 0.1;
  base = clamp(vec3(y + 0.956 * iq.x + 0.621 * iq.y, y - 0.272 * iq.x - 0.647 * iq.y, y - 1.106 * iq.x + 1.703 * iq.y), 0.0, 1.0);
#endif
  // Shaded bands deepen towards a richer version of the colour (painterly, keeps it saturated).
  vec3 shade = base * mix(vec3(0.7, 0.7, 0.84), base, 0.35);
  vec3 mid = base * mix(vec3(0.88, 0.88, 0.95), base, 0.15);
  vec3 c = mix(shade, mid, smoothstep(0.4, 0.47, hl));
  c = mix(c, base * SUNLIT, smoothstep(0.7, 0.76, hl));
  float r = 1.0 - max(dot(n, normalize(cameraPosition - vPosW)), 0.0);
  r *= r;
  c = mix(c, vec3(1.0, 0.96, 0.88), r * r * 0.12);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    {
      attributes: variant === 'sway' ? ['normal', 'uv'] : ['normal'],
      uniforms: ['color'],
      defines: variant === 'sway' ? ['SWAY'] : variant === 'shimmer' ? ['SHIMMER'] : [],
    },
  );
  m.setColor3('color', Color3.FromHexString(hex));
  return m;
}

/**
 * A 64 × 64 tiling texture of smooth random values, four independent channels: the grass, road and
 * pond read their noise from it (one cheap filtered fetch each, instead of maths per pixel).
 */
export function noiseTexture(scene: Scene): RawTexture {
  const N = 64;
  let a = new Float32Array(N * N * 4);
  let seed = 12345;
  for (let i = 0; i < a.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    a[i] = (seed >>> 8) / 16777216;
  }
  // Two wrapping 3 × 3 blurs soften the blocks into blotches.
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) sum += a[((((y + dy + N) % N) * N + ((x + dx + N) % N)) * 4) + c];
          b[(y * N + x) * 4 + c] = sum / 9;
        }
    a = b;
  }
  // Stretch each channel back to the full 0..1 range.
  const bytes = new Uint8Array(a.length);
  for (let c = 0; c < 4; c++) {
    let lo = 1, hi = 0;
    for (let i = c; i < a.length; i += 4) {
      lo = Math.min(lo, a[i]);
      hi = Math.max(hi, a[i]);
    }
    for (let i = c; i < a.length; i += 4) bytes[i] = Math.round(((a[i] - lo) / (hi - lo)) * 255);
  }
  const t = RawTexture.CreateRGBATexture(bytes, N, N, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

const FLAT_VERTEX = `attribute vec2 uv;
varying vec2 vUv;
void main() {
  vec4 p = worldMatrix() * vec4(position, 1.0);
  vPosW = p.xyz;
  vUv = uv;
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`;

/**
 * Grass: big soft patches of colour (some a touch sunnier) and very faint mown stripes, 6 m wide,
 * running along world x. Flat and up-facing, so it shows `hex` lit by the sun.
 */
export function grassMaterial(hex: string, noise: Texture, scene: Scene): ShaderMaterial {
  const m = shader(
    'grass',
    scene,
    FLAT_VERTEX,
    `uniform sampler2D noise;
uniform vec3 color;
varying vec2 vUv;
void main() {
  vec2 p = vPosW.xz;
  float big = texture2D(noise, p / 420.0).r;
  float mid = texture2D(noise, p / 90.0).g;
  vec3 c = color * SUNLIT * (0.96 + 0.06 * big + 0.03 * mid);
  c = mix(c, c * vec3(1.04, 1.02, 0.9), smoothstep(0.6, 0.9, big) * 0.4);
  // Mown stripes, only up close: far away they would shimmer into lines.
  float stripes = 1.0 - smoothstep(40.0, 90.0, vDepth);
  c *= 1.0 + 0.016 * stripes * (smoothstep(-0.3, 0.3, sin(p.y * 0.5236)) - 0.5);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'], uniforms: ['color'], samplers: ['noise'] },
  );
  m.setColor3('color', Color3.FromHexString(hex));
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
uniform vec3 color;
varying vec2 vUv;
void main() {
  vec2 p = vPosW.xz;
  float e = abs(vUv.y - 0.5) * 2.0;
  float n = texture2D(noise, p / 2.5).b;
  float big = texture2D(noise, p / 200.0).a;
  vec3 c = color * SUNLIT * (0.97 + 0.05 * big);
  c *= 1.0 + 0.035 * smoothstep(0.68, 0.85, n) - 0.03 * smoothstep(0.32, 0.15, n);
  c *= 1.0 - 0.1 * smoothstep(0.75, 1.0, e);
  float lane = (e - 0.5) / 0.09;
  c *= 1.0 - 0.035 * exp(-lane * lane);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'], uniforms: ['color'], samplers: ['noise'] },
  );
  m.setColor3('color', Color3.FromHexString(hex));
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
  const f = (v: number): string => v.toFixed(4);
  return shader(
    'boostPad',
    scene,
    FLAT_VERTEX,
    `varying vec2 vUv;
void main() {
  float across = abs(vUv.y);
  float u = fract((vUv.x + across * ${f(pad.sweep)}) / ${f(pad.spacing)} - env.x * 1.4);
  float stripe = smoothstep(0.0, 0.06, u) - smoothstep(${f(pad.depth)}, ${f(pad.depth + 0.06)}, u);
  float inside = (1.0 - smoothstep(${f(pad.halfWidth - 0.15)}, ${f(pad.halfWidth)}, across))
    * (1.0 - smoothstep(${f(pad.halfLength - 0.6)}, ${f(pad.halfLength - 0.1)}, abs(vUv.x)));
  float pulse = 0.5 + 0.5 * sin(env.x * 4.0);
  vec3 c = mix(${glsl(base)} * (0.97 + 0.05 * pulse), ${glsl(arrow)} * (0.94 + 0.1 * pulse), stripe * inside);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['uv'] },
  );
}

/** Direction of the light the pond glints with: low and ahead, so the glints face the camera. */
const GLINT = new Vector3(0.37, 0.5, 0.78).normalize();

/**
 * Pond on a disc around (x, z): water out to an irregular waterline about `radius` from the centre
 * (deeper teal in the middle, sky reflected at grazing angles, gentle travelling ripples and soft
 * glints), then a ring of sand that fades into the grass.
 */
export function pondMaterial(x: number, z: number, radius: number, scene: Scene): ShaderMaterial {
  const m = shader(
    'pond',
    scene,
    FLAT_VERTEX,
    `uniform vec3 pond;
varying vec2 vUv;
const vec3 GLINT = ${vec3(GLINT)};
void main() {
  vec2 d = vPosW.xz - pond.xy;
  float dist = length(d);
  float ang = atan(d.y, d.x);
  float edge = pond.z * (1.0 + 0.07 * sin(3.0 * ang + 0.6) + 0.04 * sin(5.0 * ang + 2.1));
  float e = dist - edge;
  float t = env.x;
  // Ripples: rings drifting out from the middle plus a slow cross swell, as a tilted normal.
  vec2 grad = d / max(dist, 0.001) * cos(dist * 2.2 - t * 1.2) * 0.05
    + vec2(cos(vPosW.x * 1.3 + vPosW.z * 0.4 + t * 0.9), cos(vPosW.z * 1.1 - vPosW.x * 0.3 - t * 0.7)) * 0.05;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 sky = mix(HORIZON, ZENITH, clamp(reflect(-v, n).y, 0.0, 1.0));
  vec3 water = mix(vec3(0.4, 0.68, 0.8), vec3(0.62, 0.85, 0.86), smoothstep(-pond.z * 0.7, 0.0, e));
  float fres = 1.0 - max(dot(n, v), 0.0);
  water = mix(water, sky, 0.2 + 0.5 * fres * fres * fres);
  water += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, normalize(v + GLINT)), 0.0), 60.0) * 0.4;
  water = mix(water, vec3(0.86, 0.95, 0.94), smoothstep(-0.5, 0.0, e) * 0.3);
  vec3 sand = mix(vec3(0.85, 0.77, 0.61), vec3(0.96, 0.9, 0.77), smoothstep(0.0, 0.5, e));
  vec3 c = mix(water, sand, smoothstep(-0.08, 0.08, e));
  gl_FragColor = vec4(fog(c), 1.0 - smoothstep(1.0, 1.7, e));
}`,
    { attributes: ['uv'], uniforms: ['pond'], alpha: true },
  );
  m.setVector3('pond', new Vector3(x, z, radius));
  return m;
}
