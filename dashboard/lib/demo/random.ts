/**
 * Deterministic randomness for the demo client.
 *
 * Every demo figure has to be stable: the same day must produce the same
 * revenue on every request, on every server instance, for the length of a
 * client presentation. `Math.random()` would reshuffle the numbers between the
 * headline card and the table below it on the very same page, because each is
 * its own server render.
 *
 * So nothing here is random at runtime — it is a hash. A value is a pure
 * function of a string key ("revenue:2026-07-14"), which means any generator
 * can ask for the same number from anywhere in the codebase, in any order,
 * without sharing state or precomputing a series.
 *
 * mulberry32 is used because it is four lines, has no dependencies, and passes
 * well enough for numbers whose only job is to look plausible on a chart.
 */

/** FNV-1a — string → 32-bit seed. */
function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform 0..1 for a key. Same key, same value, always. */
export function unit(key: string): number {
  return mulberry32(hashSeed(key))();
}

/** Uniform within [min, max]. */
export function between(key: string, min: number, max: number): number {
  return min + unit(key) * (max - min);
}

/**
 * A multiplier hovering around 1, e.g. jitter("orders:2026-07-14", 0.18).
 *
 * Averaging two draws pulls the distribution toward the centre, so a series
 * wobbles rather than lurching between the extremes on consecutive days —
 * daily revenue that swings ±18% at random reads as broken, not as noisy.
 */
export function jitter(key: string, spread: number): number {
  const a = unit(`${key}:a`);
  const b = unit(`${key}:b`);
  return 1 + ((a + b) / 2 - 0.5) * 2 * spread;
}

/** Deterministic integer in [min, max]. */
export function intBetween(key: string, min: number, max: number): number {
  return Math.floor(between(key, min, max + 0.9999));
}

/** Deterministic pick from a list. */
export function pick<T>(key: string, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(unit(key) * items.length))];
}

/**
 * Stable shuffle — used where an order should look arbitrary but never change
 * between renders (a customer table, an ad list).
 */
export function shuffled<T>(key: string, items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, sort: unit(`${key}:${i}`) }))
    .sort((a, b) => a.sort - b.sort)
    .map((x) => x.item);
}
