const DEAD_ZONE_DEG = 3;
const FULL_LOCK_DEG = 30;

/**
 * Roll of the phone (the "steering wheel" angle) in degrees, from the gravity vector the
 * accelerometer reports. Gravity is rotated into screen coordinates first so the answer is
 * the same whichever way the phone is held. The sign convention of gravity differs between
 * platforms; callers capture a neutral roll and only use the difference (see rollToSteer).
 */
export function gravityToRollDeg(gx: number, gy: number, screenAngleDeg: number): number {
  const a = (screenAngleDeg * Math.PI) / 180;
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);
  return (Math.atan2(-sx, sy) * 180) / Math.PI;
}

/** Steering in [-1, 1] from the roll relative to the neutral roll: 3° dead-zone, full lock at 30°. */
export function rollToSteer(rollDeg: number, neutralDeg: number): number {
  let d = (rollDeg - neutralDeg) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  const mag = Math.abs(d);
  if (mag <= DEAD_ZONE_DEG) return 0;
  const s = Math.min(1, (mag - DEAD_ZONE_DEG) / (FULL_LOCK_DEG - DEAD_ZONE_DEG));
  return d < 0 ? -s : s;
}
