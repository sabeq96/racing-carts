/** Ground-plane vector: world is (x, z). */
export interface Vec2 {
  x: number;
  z: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l };
};
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Wrap an angle in radians to (−π, π]. */
export function wrapAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = rad % twoPi; // (−2π, 2π)
  if (a <= -Math.PI) a += twoPi;
  else if (a > Math.PI) a -= twoPi;
  return a;
}
