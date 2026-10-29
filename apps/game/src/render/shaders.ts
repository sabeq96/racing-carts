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
export const HORIZON = '#FFD9B8';
/** Wind: unit direction on the ground (x, z). Clouds drift and trees sway along it. */
export const WIND_X = 0.96;
export const WIND_Z = 0.28;
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
const vec3 SUNLIT = vec3(1.03, 1.0, 0.95);
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

/** Sky dome: peach horizon to soft-blue zenith with a glowing sun; drawn first, behind everything. */
export function skyMaterial(scene: Scene): ShaderMaterial {
  const m = shader(
    'sky',
    scene,
    `varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = worldMatrix() * vec4(position, 1.0);
  vPosW = p.xyz;
  vDepth = 0.0;
  gl_Position = viewProjection * p;
}`,
    `varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(HORIZON, ZENITH, pow(clamp(d.y, 0.0, 1.0), 0.55));
  float s = max(dot(d, SUN), 0.0);
  c += vec3(1.0, 0.93, 0.78) * (smoothstep(0.9975, 0.9988, s) * 0.6 + pow(s, 24.0) * 0.25);
  gl_FragColor = vec4(c, 1.0);
}`,
  );
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
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
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * 0.12;
  gl_FragColor = vec4(vec3(0.24, 0.27, 0.4), a);
}`,
    { attributes: ['uv'], alpha: true },
  );
  m.disableDepthWrite = true;
  return m;
}

/**
 * Soft toon shading: three gentle bands (deep shade, mid, warm sunlit), and a subtle warm rim
 * that lifts silhouettes off the grass. Up-facing surfaces show `hex` itself. Vertex colours, if the
 * mesh has them, tint it.
 */
export function toonMaterial(name: string, hex: string, scene: Scene, rim = 0.18): ShaderMaterial {
  const m = shader(
    name,
    scene,
    `attribute vec3 normal;
#ifdef VERTEXCOLOR
attribute vec4 color;
varying vec3 vColor;
#endif
varying vec3 vNormalW;
void main() {
  mat4 w = worldMatrix();
  vec4 p = w * vec4(position, 1.0);
#ifdef VERTEXCOLOR
  vColor = color.rgb;
#endif
  vPosW = p.xyz;
  vNormalW = normalize((w * vec4(normal, 0.0)).xyz);
  vDepth = (view * p).z;
  gl_Position = viewProjection * p;
}`,
    `uniform vec3 color;
uniform float rim;
#ifdef VERTEXCOLOR
varying vec3 vColor;
#endif
varying vec3 vNormalW;
void main() {
  vec3 n = normalize(vNormalW);
  float hl = dot(n, SUN) * 0.5 + 0.5;
  vec3 base = color;
#ifdef VERTEXCOLOR
  base *= vColor;
#endif
  // Shaded bands deepen towards a richer version of the colour (painterly, keeps it saturated).
  vec3 shade = base * mix(vec3(0.7, 0.7, 0.84), base, 0.35);
  vec3 mid = base * mix(vec3(0.88, 0.88, 0.95), base, 0.15);
  vec3 c = mix(shade, mid, smoothstep(0.4, 0.47, hl));
  c = mix(c, base * SUNLIT, smoothstep(0.7, 0.76, hl));
  float r = 1.0 - max(dot(n, normalize(cameraPosition - vPosW)), 0.0);
  r *= r;
  c = mix(c, vec3(1.0, 0.96, 0.88), r * r * rim);
  gl_FragColor = vec4(fog(c), 1.0);
}`,
    { attributes: ['normal'], uniforms: ['color', 'rim'] },
  );
  m.setColor3('color', Color3.FromHexString(hex));
  m.setFloat('rim', rim);
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
