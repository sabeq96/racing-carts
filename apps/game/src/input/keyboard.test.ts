import { expect, test } from 'vitest';
import { createKeyboard } from './keyboard';

type Listener = (e: unknown) => void;

/** Just enough of a Window for createKeyboard: listeners we can fire by hand. */
function fakeWindow() {
  const listeners: Record<string, Listener[]> = {};
  const on = (type: string, fn: Listener): void => {
    (listeners[type] ??= []).push(fn);
  };
  const fire = (type: string, key: string, repeat = false): void => {
    for (const fn of listeners[type] ?? []) fn({ key, keyCode: 0, repeat, preventDefault() {} });
  };
  const target = { addEventListener: on, document: { addEventListener: on } } as unknown as Window;
  return { target, fire };
}

test('a Space tap between two reads still gives exactly one item press', () => {
  const { target, fire } = fakeWindow();
  const kb = createKeyboard(target);
  expect(kb.input().item).toBe(false);
  fire('keydown', ' ');
  fire('keyup', ' ');
  expect(kb.input().item).toBe(true);
  expect(kb.input().item).toBe(false);
});

test('holding Space reads as held; releasing reads as released', () => {
  const { target, fire } = fakeWindow();
  const kb = createKeyboard(target);
  fire('keydown', ' ');
  expect(kb.input().item).toBe(true);
  fire('keydown', ' ', true); // auto-repeat while held
  expect(kb.input().item).toBe(true);
  expect(kb.input().item).toBe(true);
  fire('keyup', ' ');
  expect(kb.input().item).toBe(false);
});

test('driving keys are plain levels', () => {
  const { target, fire } = fakeWindow();
  const kb = createKeyboard(target);
  fire('keydown', 'ArrowUp');
  fire('keydown', 'd');
  expect(kb.input()).toEqual({ steer: 1, gas: true, brake: false, item: false });
  fire('keyup', 'ArrowUp');
  expect(kb.input().gas).toBe(false);
});
