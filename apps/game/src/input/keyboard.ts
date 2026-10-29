import type { InputSnapshot } from '@rc/shared';

const LEFT = ['ArrowLeft', 'a', 'A'];
const RIGHT = ['ArrowRight', 'd', 'D'];
const GAS = ['ArrowUp', 'w', 'W'];
const BRAKE = ['ArrowDown', 's', 'S'];
const ITEM = [' ', 'Spacebar'];
const ENTER = ['Enter'];
/** Keys the game owns; the browser must not scroll the page for them. */
const CAPTURED = new Set([...LEFT, ...RIGHT, ...GAS, ...BRAKE, ...ITEM, ...ENTER]);

/** Older TV runtimes may only fill `keyCode`; map the ones we need. */
function keyOf(e: KeyboardEvent): string {
  if (e.key && e.key !== 'Unidentified') return e.key;
  switch (e.keyCode) {
    case 13: return 'Enter';
    case 32: return ' ';
    case 37: return 'ArrowLeft';
    case 38: return 'ArrowUp';
    case 39: return 'ArrowRight';
    case 40: return 'ArrowDown';
    case 65: return 'a';
    case 68: return 'd';
    case 83: return 's';
    case 87: return 'w';
    default: return '';
  }
}

/** Desktop driving: arrows/WASD steer, gas and brake; Space uses the item; Enter starts or rematches. */
export function createKeyboard(target: Window = window): { input(): InputSnapshot; onEnter(cb: () => void): void } {
  const down = new Set<string>();
  /** Set on an item keydown and cleared by the next `input()`, so a tap between two steps is not lost. */
  let itemLatch = false;
  const enterListeners: (() => void)[] = [];
  const any = (keys: string[]) => keys.some((k) => down.has(k));

  target.addEventListener('keydown', (e) => {
    const key = keyOf(e);
    if (!CAPTURED.has(key)) return;
    e.preventDefault();
    if (ENTER.includes(key)) {
      if (!e.repeat) for (const cb of enterListeners) cb();
      return;
    }
    if (ITEM.includes(key)) itemLatch = true;
    down.add(key);
  });
  target.addEventListener('keyup', (e) => {
    const key = keyOf(e);
    down.delete(key);
    // Shift held while releasing a letter reports the other case; drop both.
    if (key.length === 1) {
      down.delete(key.toLowerCase());
      down.delete(key.toUpperCase());
    }
  });
  // Keys released while the window is unfocused or hidden never send keyup; a pending tap is stale too.
  const reset = (): void => {
    down.clear();
    itemLatch = false;
  };
  target.addEventListener('blur', reset);
  target.document.addEventListener('visibilitychange', reset);

  return {
    /** Called once per fixed step. `item` is held, or pressed at any moment since the last call. */
    input(): InputSnapshot {
      const item = any(ITEM) || itemLatch;
      itemLatch = false;
      return {
        steer: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0),
        gas: any(GAS),
        brake: any(BRAKE),
        item,
      };
    },
    onEnter(cb: () => void): void {
      enterListeners.push(cb);
    },
  };
}
