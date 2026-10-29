/** Arcade kart tuning. Units: metres, seconds, radians. */
export const MAX_SPEED = 20;
export const ACCEL = 12;
export const BRAKE_DECEL = 24;
export const REVERSE_MAX = 6;
export const COAST_DECEL = 4;
export const STEER_RATE = 2.4;
export const GRIP = 6;
export const KART_RADIUS = 1;
export const WALL_RESTITUTION = 0.3;
export const WALL_SPEED_KEEP = 0.8;
/** Extra speed lost per second while touching a wall, so riding the walls never beats steering (a 0.3 s brush costs ~30%). */
export const WALL_SCRAPE = 1.2;
export const SPIN_TIME = 1.2;
export const BOOST_FACTOR = 1.6;
/** Catch-up: top speed × (1 + CATCHUP × rank fraction), 0 for the leader up to +6 % for last place. */
export const CATCHUP = 0.06;
/** Catch-up pauses while a kart touches a wall and this many seconds after, so wall-riding never earns it. */
export const CATCHUP_WALL_PAUSE = 2;

/** Drift: starts with BRAKE + |steer| > DRIFT_START_STEER above DRIFT_START_SPEED (m/s), not while spinning. */
export const DRIFT_START_STEER = 0.3;
export const DRIFT_START_SPEED = 10;
/** A drift ends (and pays out its mini-turbo) on BRAKE release, |steer| <= DRIFT_END_STEER or speed < DRIFT_END_SPEED. */
export const DRIFT_END_STEER = 0.15;
export const DRIFT_END_SPEED = 6;
/** While drifting: mild drag instead of braking (m/s²), steer rate multiplier, and lower grip so the kart slides. */
export const DRIFT_DRAG = 2;
export const DRIFT_STEER = 1.3;
export const DRIFT_GRIP = 2.5;
/** Mini-turbo: seconds of drift charge for level 1 / 2, and the boost seconds each pays on release. */
export const MT1 = 0.6;
export const MT2 = 1.3;
export const MT1_BOOST = 0.6;
export const MT2_BOOST = 1.2;
