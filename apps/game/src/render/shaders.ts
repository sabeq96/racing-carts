import type { Scene } from '@babylonjs/core/scene';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

/*
 * Small hand-written GLSL ES 1.00 shaders (WebGL1-safe; Babylon upgrades them for WebGL2). They share
 * one golden-afternoon light set, baked in as constants, and Babylon's linear fog uniforms.
 */

/** Direction towards the sun: high, behind the camera's right shoulder, so fronts of things are lit. */
export const SUN_DIR = new Vector3(0.5, 0.8, -0.6).normalize();
export const HORIZON = '#FFD9B8';
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
