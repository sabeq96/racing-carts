import type { Kart } from '../kart/kart';
import { getPowerup } from './registry';
import type { WorldApi } from './types';

/**
 * Item button handling. Phones (and the keyboard) send the button as a level, so only a fresh press
 * (rising edge, tracked in `k.itemPressed`) fires the held item, once; the item is cleared before `use`.
 */
export function handleItemInput(k: Kart, pressed: boolean, world: WorldApi): void {
  const rising = pressed && !k.itemPressed;
  k.itemPressed = pressed;
  if (!rising || k.item === null) return;
  const def = getPowerup(k.item);
  k.item = null;
  if (def) def.use({ kart: k, world });
}
