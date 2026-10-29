/**
 * Remembers a button press until the next read, so a tap shorter than one 30 Hz send interval is
 * still sent once. `read(level)` gives `level || pressed since the last read`, then forgets the press.
 */
export function createPressLatch(): { press(): void; read(level: boolean): boolean } {
  let latched = false;
  return {
    press(): void {
      latched = true;
    },
    read(level: boolean): boolean {
      const v = level || latched;
      latched = false;
      return v;
    },
  };
}
