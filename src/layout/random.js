/** seed から再現可能な乱数列を作る (sfc32)。[0, 1) の数を返す関数。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  let b = Math.floor(seed / 4294967296) >>> 0;
  let c = 0x9e3779b9;
  let d = 0x243f6a88;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

/** lo 以上 hi 以下の整数 */
export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

export const pick = (list, rng) => list[Math.floor(rng() * list.length)];

export function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** 「別の案」用の新しい seed (0 は既定の案なので使わない) */
export const newSeed = () => 1 + Math.floor(Math.random() * 0xfffffffe);
