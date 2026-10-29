import { afterEach, describe, expect, test } from 'vitest';
import { KART_COLORS, NEUTRAL_INPUT } from '@rc/shared';
import { createKart, stepKart, type Kart } from '../kart/kart';
import { KART_RADIUS, MAX_SPEED, SPIN_TIME } from '../kart/tuning';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { mulberry32 } from '../test/rand';
import { ItemBoxes } from './itemBoxes';
import { POWERUPS, getPowerup } from './registry';
import { rankFraction } from './odds';
import { rollItem } from './roll';
import type { BotContext, PowerupDef, PowerupEntity, WorldApi } from './types';
import { handleItemInput } from './useItem';
import { createWorld } from './world';

const track = buildTrack(TRACK_V1);
const DT = 1 / 60;
const gas = { steer: 0, gas: true, brake: false, item: false };

const mkKarts = (n: number): Kart[] =>
  Array.from({ length: n }, (_, i) => createKart(i, KART_COLORS[i], track.grid[i], track));

/** Places a kart on the centre line at track distance `s` (and keeps `distance` in step). */
function placeAt(k: Kart, s: number, lateral = 0): void {
  const p = track.pointAt(s, lateral);
  k.pos = { x: p.x, z: p.z };
  k.heading = track.headingAt(s);
  k.trackIndex = track.project(k.pos).index;
  k.distance = s;
}

const TEST_DEF: PowerupDef = {
  id: 'test',
  name: 'T',
  icon: '🧪',
  weight: () => 1000,
  use: ({ kart, world }) => world.applyEffect(kart, 'test', 1),
};

afterEach(() => {
  // A failed test must not leave the temporary def in the shared registry.
  const i = POWERUPS.indexOf(TEST_DEF);
  if (i >= 0) POWERUPS.splice(i, 1);
});

describe('rollItem', () => {
  test('rollItem favours shield/mine for leader and boost/rocket for last', () => {
    const count = (position: number): Record<string, number> => {
      const rand = mulberry32(position * 101);
      const seen: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        const id = rollItem({ position, racerCount: 6 }, rand);
        seen[id] = (seen[id] ?? 0) + 1;
      }
      return seen;
    };
    const leader = count(1);
    const last = count(6);
    // Leader: shield 3 vs boost 1 → ~75 % shield. Last: shield 1 vs boost 4 → ~80 % boost.
    expect(leader.shield).toBeGreaterThan(1350);
    expect(leader.shield).toBeLessThan(1650);
    expect(last.boost).toBeGreaterThan(1450);
    expect(last.boost).toBeLessThan(1750);
    expect(leader.shield).toBeGreaterThan(last.shield);
    expect(last.boost).toBeGreaterThan(leader.boost);
  });

  test('rollItem rand=0 picks first def with weight>0', () => {
    const none: PowerupDef = { ...TEST_DEF, id: 'none', weight: () => 0 };
    const ctx = { position: 3, racerCount: 6 };
    expect(rollItem(ctx, () => 0, [none, ...POWERUPS])).toBe(POWERUPS[0].id);
    expect(rollItem(ctx, () => 0)).toBe(POWERUPS[0].id);
    // Just below 1 lands on the last def with weight.
    expect(rollItem(ctx, () => 0.999999, [...POWERUPS, none])).toBe(POWERUPS[POWERUPS.length - 1].id);
  });

  test('rank fraction: 0 for the leader, 1 for last, 0 when racing alone', () => {
    expect(rankFraction({ position: 1, racerCount: 6 })).toBe(0);
    expect(rankFraction({ position: 6, racerCount: 6 })).toBe(1);
    expect(rankFraction({ position: 3, racerCount: 5 })).toBe(0.5);
    expect(rankFraction({ position: 1, racerCount: 1 })).toBe(0);
  });

  test('item weights follow the brief', () => {
    const shield = getPowerup('shield') as PowerupDef;
    const boost = getPowerup('boost') as PowerupDef;
    expect(shield.weight({ position: 1, racerCount: 6 })).toBe(3);
    expect(shield.weight({ position: 6, racerCount: 6 })).toBe(1);
    expect(boost.weight({ position: 1, racerCount: 6 })).toBe(1);
    expect(boost.weight({ position: 6, racerCount: 6 })).toBe(4);
    expect(POWERUPS.map((d) => d.id)).toEqual(['shield', 'boost']);
    expect(getPowerup('nope')).toBeUndefined();
  });
});

describe('item boxes', () => {
  test('box gives a 1 s roll, then the item; ignored while holding', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const boxes = new ItemBoxes(track);
    expect(boxes.boxes.map((b) => b.pos)).toEqual(track.itemBoxes);
    const rand = mulberry32(5);
    const k = karts[0];
    const home = { ...k.pos };

    k.pos = { ...boxes.boxes[0].pos };
    expect(boxes.update(DT, karts, world, rand)).toEqual([]);
    expect(k.rolling).not.toBeNull();
    expect(k.rolling?.left).toBe(1);
    const rolled = k.rolling?.item as string;
    expect(POWERUPS.map((d) => d.id)).toContain(rolled);
    expect(k.item).toBeNull();
    expect(boxes.boxes[0].respawn).toBe(3);
    expect(world.drainSfx()).toContain('item_box_pickup');

    k.pos = home;
    for (let i = 0; i < 59; i++) expect(boxes.update(DT, karts, world, rand)).toEqual([]);
    expect(k.rolling).not.toBeNull();
    expect(boxes.update(DT, karts, world, rand)).toEqual([0]);
    expect(k.rolling).toBeNull();
    expect(k.item).toBe(rolled);

    // Holding an item: the box still hides, but gives nothing.
    k.pos = { ...boxes.boxes[1].pos };
    boxes.update(DT, karts, world, rand);
    expect(boxes.boxes[1].respawn).toBe(3);
    expect(k.rolling).toBeNull();
    expect(k.item).toBe(rolled);

    // Rolling: the next box gives nothing either.
    k.item = null;
    k.rolling = { left: 0.5, item: 'boost' };
    k.pos = { ...boxes.boxes[2].pos };
    boxes.update(DT, karts, world, rand);
    expect(boxes.boxes[2].respawn).toBe(3);
    expect(k.rolling).toEqual({ left: 0.5 - DT, item: 'boost' });
  });

  test('box pickup radius is 1.5 + KART_RADIUS', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const boxes = new ItemBoxes(track);
    const b = boxes.boxes[0].pos;
    karts[0].pos = { x: b.x + 1.5 + KART_RADIUS + 0.01, z: b.z };
    boxes.update(DT, karts, world, mulberry32(1));
    expect(boxes.boxes[0].respawn).toBe(0);
    karts[0].pos = { x: b.x + 1.5 + KART_RADIUS - 0.01, z: b.z };
    boxes.update(DT, karts, world, mulberry32(1));
    expect(boxes.boxes[0].respawn).toBe(3);
  });

  test('box respawns after 3 s', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const boxes = new ItemBoxes(track);
    const rand = mulberry32(9);
    const [a, b] = karts;
    const home = { ...a.pos };
    a.pos = { ...boxes.boxes[3].pos };
    boxes.update(DT, karts, world, rand);
    a.pos = home;
    for (let i = 0; i < 178; i++) boxes.update(DT, karts, world, rand);
    // 2.98 s later the box is still hidden: a kart driving through gets nothing.
    b.pos = { ...boxes.boxes[3].pos };
    boxes.update(DT, karts, world, rand);
    expect(boxes.boxes[3].respawn).toBeGreaterThan(0);
    expect(b.rolling).toBeNull();
    // At 3 s it is back, and the kart sitting in it takes it.
    boxes.update(DT, karts, world, rand);
    expect(b.rolling).not.toBeNull();
    expect(boxes.boxes[3].respawn).toBe(3);
  });

  test('a hidden box gives nothing', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const boxes = new ItemBoxes(track);
    const rand = mulberry32(2);
    karts[0].pos = { ...boxes.boxes[0].pos };
    karts[1].pos = { ...boxes.boxes[0].pos, x: boxes.boxes[0].pos.x + 0.1 };
    boxes.update(DT, karts, world, rand);
    // Only the first kart in the list gets the roll; the box is gone for the second.
    expect(karts[0].rolling).not.toBeNull();
    expect(karts[1].rolling).toBeNull();
  });

  test('the roll uses the kart race position (leader rolls mostly shields)', () => {
    const karts = mkKarts(6);
    const world = createWorld(karts, track);
    const rand = mulberry32(77);
    karts.forEach((k, i) => placeAt(k, 100 - i * 10));
    const leader = karts[0];
    let shields = 0;
    for (let i = 0; i < 400; i++) {
      const boxes = new ItemBoxes(track);
      leader.rolling = null;
      leader.item = null;
      const keep = { ...leader.pos };
      leader.pos = { ...boxes.boxes[0].pos };
      boxes.update(DT, karts, world, rand);
      const roll = leader.rolling as Kart['rolling']; // TS narrowed it to null above
      if (roll?.item === 'shield') shields++;
      leader.pos = keep;
    }
    expect(shields).toBeGreaterThan(250);
  });
});

describe('using items', () => {
  test('item press uses item once on rising edge and clears it', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    k.item = 'boost';
    handleItemInput(k, true, world);
    expect(k.item).toBeNull();
    expect(world.hasEffect(k, 'boost')).toBe(true);
    expect(world.drainSfx()).toEqual(['boost']);

    // Still held (phones send a level at 30 Hz): a new item is not fired.
    k.item = 'shield';
    handleItemInput(k, true, world);
    handleItemInput(k, true, world);
    expect(k.item).toBe('shield');
    expect(world.hasEffect(k, 'shield')).toBe(false);

    handleItemInput(k, false, world);
    expect(k.item).toBe('shield');
    handleItemInput(k, true, world);
    expect(k.item).toBeNull();
    expect(world.hasEffect(k, 'shield')).toBe(true);
    expect(world.drainSfx()).toEqual(['shield_up']);

    // Pressing with nothing held does nothing.
    handleItemInput(k, false, world);
    handleItemInput(k, true, world);
    expect(world.drainSfx()).toEqual([]);
  });

  test('pressing while rolling does nothing and does not fire the item when the roll ends', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    k.rolling = { left: 0.1, item: 'boost' };
    handleItemInput(k, true, world);
    expect(k.rolling).not.toBeNull();
    k.rolling = null;
    k.item = 'boost';
    handleItemInput(k, true, world); // still the same press
    expect(k.item).toBe('boost');
  });

  test('an unknown item id is dropped harmlessly', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    karts[0].item = 'gone';
    handleItemInput(karts[0], true, world);
    expect(karts[0].item).toBeNull();
  });
});

describe('shield, boost and hits', () => {
  test('shield absorbs one hit then is gone; expires after 6 s', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    k.speed = 10;
    k.item = 'shield';
    handleItemInput(k, true, world);
    expect(world.hasEffect(k, 'shield')).toBe(true);
    world.drainSfx();

    expect(world.hitKart(k)).toBe(false);
    expect(k.spin).toBe(0);
    expect(k.speed).toBe(10);
    expect(world.hasEffect(k, 'shield')).toBe(false);
    expect(world.drainSfx()).toEqual(['shield_break']);
    expect(world.drainHits()).toEqual([]);
    // The next hit lands.
    expect(world.hitKart(k)).toBe(true);
    expect(k.spin).toBe(SPIN_TIME);

    // A fresh shield runs out after 6 s.
    world.applyEffect(k, 'shield', 6);
    for (let i = 0; i < 359; i++) world.step(DT);
    expect(world.hasEffect(k, 'shield')).toBe(true);
    world.step(DT);
    expect(world.hasEffect(k, 'shield')).toBe(false);
    expect(k.effects).toEqual([]);
  });

  test('boost lasts 1.5 s and lets speed exceed MAX_SPEED', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    placeAt(k, 0);
    k.speed = MAX_SPEED;
    k.vel = { x: Math.sin(k.heading) * MAX_SPEED, z: Math.cos(k.heading) * MAX_SPEED };
    k.item = 'boost';
    handleItemInput(k, true, world);
    let top = 0;
    for (let i = 0; i < 90; i++) {
      expect(world.hasEffect(k, 'boost')).toBe(true);
      stepKart(k, gas, track, DT);
      world.step(DT);
      top = Math.max(top, k.speed);
    }
    expect(world.hasEffect(k, 'boost')).toBe(false);
    // +60 % top speed; 1.5 s at ACCEL 12 reaches it from MAX_SPEED.
    expect(top).toBeGreaterThan(MAX_SPEED * 1.5);
    expect(top).toBeLessThanOrEqual(MAX_SPEED * 1.6 + 1e-9);
    // Afterwards the kart eases back down to MAX_SPEED.
    for (let i = 0; i < 120; i++) stepKart(k, gas, track, DT);
    expect(k.speed).toBeCloseTo(MAX_SPEED, 5);
  });

  test('using an effect again refreshes its timer instead of stacking', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const k = karts[0];
    world.applyEffect(k, 'boost', 1.5);
    for (let i = 0; i < 60; i++) world.step(DT);
    world.applyEffect(k, 'boost', 1.5);
    expect(k.effects).toEqual([{ kind: 'boost', remaining: 1.5 }]);
    world.removeEffect(k, 'boost');
    expect(world.hasEffect(k, 'boost')).toBe(false);
  });

  test('hitKart without shield spins for 1.2 s and reports hit', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const k = karts[1];
    k.speed = 15;
    expect(world.hitKart(k)).toBe(true);
    expect(k.spin).toBe(SPIN_TIME);
    expect(SPIN_TIME).toBe(1.2);
    expect(k.speed).toBeCloseTo(3);
    expect(world.drainSfx()).toEqual(['kart_spinout']);
    expect(world.drainHits()).toEqual([1]);
    expect(world.drainHits()).toEqual([]);
    for (let i = 0; i < 71; i++) stepKart(k, NEUTRAL_INPUT, track, DT);
    expect(k.spin).toBeGreaterThan(0);
    stepKart(k, NEUTRAL_INPUT, track, DT);
    expect(k.spin).toBe(0);
  });
});

describe('world', () => {
  const entity = (over: Partial<PowerupEntity> = {}): PowerupEntity & { updates: number; hits: number[] } => ({
    pos: { x: 0, z: 0 },
    heading: 0,
    look: { shape: 'sphere', color: '#FF8A80', size: 1 },
    hitRadius: 0.5,
    dead: false,
    updates: 0,
    hits: [],
    update() {
      this.updates++;
    },
    onHitKart(k) {
      this.hits.push(k.id);
    },
    ...over,
  });

  test('step updates entities, reports kart contacts within hitRadius + KART_RADIUS and drops dead ones', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const e = entity();
    e.pos = { x: karts[0].pos.x + 0.5 + KART_RADIUS - 0.01, z: karts[0].pos.z };
    world.spawnEntity(e);
    expect(world.entities).toEqual([e]);
    world.step(DT);
    expect(e.updates).toBe(1);
    expect(e.hits).toEqual([0]);
    e.pos = { x: karts[0].pos.x + 0.5 + KART_RADIUS + 0.01, z: karts[0].pos.z };
    world.step(DT);
    expect(e.hits).toEqual([0]);
    e.dead = true;
    world.step(DT);
    expect(world.entities).toEqual([]);
    expect(e.updates).toBe(2);
    expect(world.time).toBeCloseTo(3 * DT);
  });

  test('an entity killed by its hit touches no further karts', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    karts[1].pos = { ...karts[0].pos };
    const e = entity({
      pos: { ...karts[0].pos },
      onHitKart(k: Kart, w: WorldApi) {
        w.hitKart(k);
        this.dead = true;
      },
    });
    world.spawnEntity(e);
    world.step(DT);
    expect(world.drainHits()).toEqual([0]);
    expect(world.entities).toEqual([]);
  });

  test('kartAhead / kartBehind follow race order; gapTo is the distance difference', () => {
    const karts = mkKarts(3);
    const world = createWorld(karts, track);
    karts[0].distance = 50;
    karts[1].distance = 80;
    karts[2].distance = 20;
    expect(world.kartAhead(karts[0])).toBe(karts[1]);
    expect(world.kartBehind(karts[0])).toBe(karts[2]);
    expect(world.kartAhead(karts[1])).toBeNull();
    expect(world.kartBehind(karts[2])).toBeNull();
    expect(world.gapTo(karts[0], karts[1])).toBe(30);
    expect(world.gapTo(karts[0], karts[2])).toBe(-30);
  });

  test('drains are empty when nothing happened', () => {
    const world = createWorld(mkKarts(1), track);
    expect(world.drainSfx()).toEqual([]);
    expect(world.drainHits()).toEqual([]);
  });
});

describe('bot decisions', () => {
  const ctx = (world: WorldApi, kart: Kart, heldFor: number): BotContext => ({ kart, world, heldFor });

  test('shield: after holding it 5 s, or at once when something homes in on the kart', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    const shield = getPowerup('shield') as PowerupDef;
    expect(shield.botShouldUse?.(ctx(world, karts[0], 4))).toBe(false);
    expect(shield.botShouldUse?.(ctx(world, karts[0], 5.1))).toBe(true);
    world.spawnEntity({
      pos: { x: 999, z: 999 },
      heading: 0,
      look: { shape: 'cone', color: '#82B1FF', size: 1 },
      hitRadius: 1,
      dead: false,
      targetId: 0,
      update() {},
    });
    expect(shield.botShouldUse?.(ctx(world, karts[0], 0))).toBe(true);
    expect(shield.botShouldUse?.(ctx(world, karts[1], 0))).toBe(false);
  });

  test('boost: only with a straight ahead', () => {
    const karts = mkKarts(1);
    const world = createWorld(karts, track);
    const boost = getPowerup('boost') as PowerupDef;
    placeAt(karts[0], 20);
    expect(boost.botShouldUse?.(ctx(world, karts[0], 0))).toBe(true);
    placeAt(karts[0], 215);
    expect(boost.botShouldUse?.(ctx(world, karts[0], 0))).toBe(false);
  });
});

describe('modularity', () => {
  test('adding a new PowerupDef to the list needs no other change', () => {
    const karts = mkKarts(2);
    const world = createWorld(karts, track);
    expect(rollItem({ position: 1, racerCount: 2 }, mulberry32(3), [...POWERUPS, TEST_DEF])).toBe('test');

    POWERUPS.push(TEST_DEF);
    expect(getPowerup('test')).toBe(TEST_DEF);
    // An item box rolls it too, straight from the registry.
    const boxes = new ItemBoxes(track);
    karts[0].pos = { ...boxes.boxes[0].pos };
    boxes.update(DT, karts, world, mulberry32(4));
    expect(karts[0].rolling?.item).toBe('test');

    karts[1].item = 'test';
    handleItemInput(karts[1], true, world);
    expect(karts[1].item).toBeNull();
    expect(world.hasEffect(karts[1], 'test')).toBe(true);
    POWERUPS.splice(POWERUPS.indexOf(TEST_DEF), 1);
    expect(getPowerup('test')).toBeUndefined();
  });
});
