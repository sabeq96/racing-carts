import { describe, expect, test } from 'vitest';
import { KART_COLORS } from '@rc/shared';
import { createWorld } from '../powerups/world';
import { buildTrack } from '../track/track';
import { TRACK_V1 } from '../track/trackDef';
import { createKart, effectLeft, type Kart } from './kart';
import { DRAFT_BOOST, DRAFT_TIME, stepSlipstream } from './slipstream';

const track = buildTrack(TRACK_V1);
const DT = 1 / 60;
const S = 10; // on the start straight

function kart(id: number, s: number, lateral: number, speed: number): Kart {
  const k = createKart(id, KART_COLORS[id], track.grid[id], track);
  k.pos = track.pointAt(s, lateral);
  k.heading = track.headingAt(s);
  k.trackIndex = track.project(k.pos).index;
  k.distance = s;
  k.speed = speed;
  return k;
}

/** A follower `gap` metres behind a leader, `lateral` metres apart, at the given speeds. */
function pair(gap: number, lateral = 0, speed = 15, leaderSpeed = 15) {
  const follower = kart(0, S, 0, speed);
  const leader = kart(1, S + gap, lateral, leaderSpeed);
  const karts = [follower, leader];
  return { follower, leader, karts, world: createWorld(karts, track) };
}

const drafts = (gap: number, lateral = 0, speed = 15, leaderSpeed = 15): boolean => {
  const p = pair(gap, lateral, speed, leaderSpeed);
  stepSlipstream(p.karts, p.world, DT);
  return p.follower.draft > 0;
};

describe('slipstream', () => {
  test('createKart starts with no draft', () => {
    expect(kart(0, S, 0, 0).draft).toBe(0);
  });

  test('drafting window: 2-12 m behind the next kart, < 2.5 m apart sideways, both faster than 8 m/s', () => {
    expect(drafts(6)).toBe(true);
    expect(drafts(1.9)).toBe(false);
    expect(drafts(2.1)).toBe(true);
    expect(drafts(11.9)).toBe(true);
    expect(drafts(12.1)).toBe(false);
    expect(drafts(6, 2.4)).toBe(true);
    expect(drafts(6, -2.4)).toBe(true);
    expect(drafts(6, 2.6)).toBe(false);
    expect(drafts(6, 0, 7.9)).toBe(false);
    expect(drafts(6, 0, 15, 7.9)).toBe(false);
    expect(drafts(6, 0, 8.1, 8.1)).toBe(true);
  });

  test('the leader never drafts (nobody ahead)', () => {
    const p = pair(6);
    stepSlipstream(p.karts, p.world, DT);
    expect(p.leader.draft).toBe(0);
  });

  test('after 1 s of drafting: a 0.8 s boost, a boost sound, and the draft starts over', () => {
    expect(DRAFT_TIME).toBe(1);
    expect(DRAFT_BOOST).toBe(0.8);
    const p = pair(6);
    for (let i = 0; i < 59; i++) stepSlipstream(p.karts, p.world, DT);
    expect(p.follower.draft).toBeGreaterThan(0.95);
    expect(effectLeft(p.follower, 'boost')).toBe(0);
    expect(p.world.drainSfx()).toEqual([]);
    stepSlipstream(p.karts, p.world, DT);
    expect(effectLeft(p.follower, 'boost')).toBeCloseTo(0.8, 9);
    expect(p.world.drainSfx()).toEqual(['boost']);
    expect(p.follower.draft).toBe(0);
  });

  test('out of the window the draft decays at twice the rate', () => {
    const p = pair(6);
    p.follower.draft = 0.5;
    p.leader.distance = S + 20;
    for (let i = 0; i < 6; i++) stepSlipstream(p.karts, p.world, DT);
    expect(p.follower.draft).toBeCloseTo(0.3, 9);
    for (let i = 0; i < 60; i++) stepSlipstream(p.karts, p.world, DT);
    expect(p.follower.draft).toBe(0);
  });

  test('finished karts are ignored: no drafting behind one, and a finished kart never drafts', () => {
    const p = pair(6);
    p.leader.finishedAt = 30;
    stepSlipstream(p.karts, p.world, DT);
    expect(p.follower.draft).toBe(0);

    const q = pair(6);
    q.follower.finishedAt = 31;
    q.leader.finishedAt = 30;
    q.follower.draft = 0.4;
    stepSlipstream(q.karts, q.world, DT);
    expect(q.follower.draft).toBe(0);
  });

  test('drafts behind the next racing kart even with a finished kart in between', () => {
    const p = pair(6);
    const done = kart(2, S + 3, 0, 15);
    done.finishedAt = 20; // ranks first, out of the race
    const karts = [p.follower, p.leader, done];
    const world = createWorld(karts, track);
    stepSlipstream(karts, world, DT);
    expect(p.follower.draft).toBeGreaterThan(0);
  });
});
