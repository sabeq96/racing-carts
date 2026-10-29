/** Longest real frame time simulated at once; a stalled tab resumes instead of fast-forwarding. */
const MAX_FRAME = 0.25;
/** Tolerance so float rounding of e.g. 2 × (1/60) never drops a step. */
const EPS = 1e-9;

/** Fixed-timestep accumulator: real frame time in, whole simulation steps out. */
export class FixedStepper {
  readonly dt: number;
  private acc = 0;

  constructor(hz = 60) {
    this.dt = 1 / hz;
  }

  /** Runs `step(dt)` for every whole step due and returns how many ran. */
  advance(realDt: number, step: (dt: number) => void): number {
    if (!(realDt > 0)) return 0;
    this.acc += Math.min(MAX_FRAME, realDt);
    let n = 0;
    while (this.acc + EPS >= this.dt) {
      this.acc -= this.dt;
      step(this.dt);
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    return n;
  }
}
