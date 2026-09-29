import { makeRng, pick, randInt, shuffle } from './random.js';
import { makeCell } from './cell.js';

/** C で主役にする写真の重み */
export const FEATURED_WEIGHT = 4;

/**
 * B: 二分割ツリー / C: メリハリ型 のレイアウト。
 *
 * キャンバスを縦か横に再帰的に 2 分割していく「ギロチン分割」で写真を並べる。
 * どの写真をどうまとめ、どちら向きに切るかを焼きなまし法で探し、
 * 「各セルと写真の比率のずれ (= トリミング量)」と「面積の目標からのずれ」が小さい案を選ぶ。
 * - uniform (B): 面積はなるべく均等に
 * - featured (C): 重み (★) に比例した面積に
 */
export function slicingLayout(photos, canvas, spacing, seed, mode) {
  if (!photos.length || canvas.w <= 0 || canvas.h <= 0) return [];
  if (photos.length === 1) return [makeCell({ x: 0, y: 0, w: 1, h: 1 }, photos[0].id)];

  const rng = makeRng((seed ^ (mode === 'uniform' ? 0xb0b0 : 0xc0c0)) >>> 0);
  const weights = mode === 'uniform'
    ? photos.map(() => 1)
    : featuredWeights(photos, seed, rng);
  const total = weights.reduce((s, v) => s + v, 0);

  const problem = new SlicingProblem({
    aspects: photos.map((p) => Math.max(p.aspect, 0.01)),
    targetAreas: weights.map((w) => w / total),
    width: canvas.w,
    height: canvas.h,
    spacing: Math.max(spacing, 0),
    areaWeight: mode === 'uniform' ? 0.4 : 0.5,
  });
  const tree = problem.search(rng);
  return problem.cells(tree, photos);
}

/** C の重み。★ が付いた写真があればそれを使い、なければ主役を自動で選ぶ。 */
function featuredWeights(photos, seed, rng) {
  if (photos.some((p) => p.weight > 1)) return photos.map((p) => Math.max(p.weight, 0.1));
  const n = photos.length;
  const heroCount = n <= 3 ? 1 : Math.max(1, Math.round(n * 0.15));
  // 既定の案は選んだ順の先頭を主役に、別の案では主役も選び直す
  const indices = [...Array(n).keys()];
  if (seed !== 0) shuffle(indices, rng);
  const heroes = new Set(indices.slice(0, heroCount));
  return photos.map((_, i) => (heroes.has(i) ? FEATURED_WEIGHT : 1));
}

/*
 * 二分割ツリー。葉が写真、内部ノードが分割。
 * 配列で持つ: left / right (葉は -1)、photo (葉のみ)、side (1: 左右に並べる = 縦に切る / 0: 上下に積む)
 * どのノードが葉かは変異で変わらないので、internal / leaves の一覧は複製間で共有する。
 */
function cloneTree(t) {
  return {
    left: t.left.slice(), right: t.right.slice(), photo: t.photo.slice(), side: t.side.slice(),
    root: t.root, internal: t.internal, leaves: t.leaves,
  };
}

class SlicingProblem {
  constructor({ aspects, targetAreas, width, height, spacing, areaWeight }) {
    Object.assign(this, { aspects, targetAreas, width, height, spacing, areaWeight });
    this.n = aspects.length;
    this.nodeAspect = new Float64Array(2 * this.n - 1);
  }

  // MARK: 探索

  search(rng) {
    // 問題の大きさによらず計算量がほぼ一定になるよう反復回数を決める
    const iterations = Math.min(20000, Math.max(4000, Math.floor(600000 / this.n)));
    const restarts = 3;
    let best = null;
    for (let r = 0; r < restarts; r++) {
      let tree = this.randomTree(rng);
      let current = this.score(tree);
      let localBest = { tree, score: current };
      const startT = 0.3, endT = 0.001;
      for (let step = 0; step < iterations; step++) {
        const t = startT * Math.pow(endT / startT, step / iterations);
        const candidate = cloneTree(tree);
        this.mutate(candidate, rng);
        const s = this.score(candidate);
        if (s < current || rng() < Math.exp((current - s) / t)) {
          tree = candidate;
          current = s;
          if (s < localBest.score) localBest = { tree, score: s };
        }
      }
      if (!best || localBest.score < best.score) best = localBest;
    }
    return best.tree;
  }

  /** キャンバスの形に合わせた向きで、ランダムに 2 分割していく初期解 */
  randomTree(rng) {
    const size = 2 * this.n - 1;
    const t = {
      left: new Int32Array(size).fill(-1),
      right: new Int32Array(size).fill(-1),
      photo: new Int32Array(size).fill(-1),
      side: new Uint8Array(size),
      root: 0,
    };
    let count = 0;
    const order = shuffle([...Array(this.n).keys()], rng);
    const build = (lo, hi, aspect) => {
      const leaves = hi - lo;
      if (leaves === 1) {
        t.photo[count] = order[lo];
        return count++;
      }
      const k = randInt(rng, Math.max(1, Math.floor(leaves / 3)),
        Math.max(1, Math.min(leaves - 1, Math.floor((2 * leaves + 2) / 3))));
      const sideBySide = aspect >= 1;
      const ratio = k / leaves;
      const a1 = sideBySide ? aspect * ratio : aspect / ratio;
      const a2 = sideBySide ? aspect * (1 - ratio) : aspect / (1 - ratio);
      const left = build(lo, lo + k, a1);
      const right = build(lo + k, hi, a2);
      t.left[count] = left;
      t.right[count] = right;
      t.side[count] = sideBySide ? 1 : 0;
      return count++;
    };
    t.root = build(0, this.n, this.width / this.height);
    const all = [...Array(size).keys()];
    t.internal = all.filter((i) => t.left[i] >= 0);
    t.leaves = all.filter((i) => t.left[i] < 0);
    return t;
  }

  /** 近傍の案を作る: 分割の向きを反転 / 写真を交換 / ツリーの回転 (まとめ方の変更) */
  mutate(t, rng) {
    const isLeaf = (i) => t.left[i] < 0;
    switch (randInt(rng, 0, 2)) {
      case 0: {
        const i = pick(t.internal, rng);
        t.side[i] ^= 1;
        break;
      }
      case 1: {
        const a = pick(t.leaves, rng);
        const b = pick(t.leaves, rng);
        [t.photo[a], t.photo[b]] = [t.photo[b], t.photo[a]];
        break;
      }
      default: {
        // X(C(a, b), d) → X(a, C(b, d))  または左右対称の回転
        const candidates = t.internal.filter((x) => !isLeaf(t.left[x]) || !isLeaf(t.right[x]));
        if (!candidates.length) return;
        const x = pick(candidates, rng);
        const leftInternal = !isLeaf(t.left[x]);
        const rightInternal = !isLeaf(t.right[x]);
        const useLeft = leftInternal && (!rightInternal || rng() < 0.5);
        if (useLeft) {
          const c = t.left[x];
          const a = t.left[c], b = t.right[c], d = t.right[x];
          t.left[x] = a;
          t.left[c] = b;
          t.right[c] = d;
          t.right[x] = c;
        } else {
          const c = t.right[x];
          const a = t.left[x], b = t.left[c], d = t.right[c];
          t.left[c] = a;
          t.right[c] = b;
          t.left[x] = c;
          t.right[x] = d;
        }
      }
    }
  }

  // MARK: 配置と評価

  /** 各写真のセル (ピクセル座標)。並べられなければ null */
  frames(t) {
    const { aspects, spacing, nodeAspect } = this;
    const aspect = (i) => {
      let a;
      if (t.left[i] < 0) {
        a = aspects[t.photo[i]];
      } else {
        const a1 = aspect(t.left[i]);
        const a2 = aspect(t.right[i]);
        // 左右: 高さを揃えると比率は和、上下: 幅を揃えると比率の逆数が和
        a = t.side[i] ? a1 + a2 : 1 / (1 / a1 + 1 / a2);
      }
      nodeAspect[i] = a;
      return a;
    };
    aspect(t.root);

    const n = this.n;
    const out = { x: new Float64Array(n), y: new Float64Array(n), w: new Float64Array(n), h: new Float64Array(n) };
    let ok = true;
    const place = (i, x, y, w, h) => {
      if (!ok) return;
      if (t.left[i] < 0) {
        const p = t.photo[i];
        out.x[p] = x; out.y[p] = y; out.w[p] = w; out.h[p] = h;
        return;
      }
      const a1 = nodeAspect[t.left[i]];
      const a2 = nodeAspect[t.right[i]];
      if (t.side[i]) {
        const available = w - spacing;
        if (available <= 0) { ok = false; return; }
        const w1 = (available * a1) / (a1 + a2);
        place(t.left[i], x, y, w1, h);
        place(t.right[i], x + w1 + spacing, y, available - w1, h);
      } else {
        const available = h - spacing;
        if (available <= 0) { ok = false; return; }
        const h1 = (available * (1 / a1)) / (1 / a1 + 1 / a2);
        place(t.left[i], x, y, w, h1);
        place(t.right[i], x, y + h1 + spacing, w, available - h1);
      }
    };
    place(t.root, 0, 0, this.width, this.height);
    return ok ? out : null;
  }

  score(t) {
    const f = this.frames(t);
    if (!f) return Infinity;
    const n = this.n;
    let totalArea = 0;
    for (let i = 0; i < n; i++) totalArea += f.w[i] * f.h[i];
    let crop = 0;
    let area = 0;
    for (let i = 0; i < n; i++) {
      if (f.w[i] <= 0 || f.h[i] <= 0) return Infinity;
      crop += Math.abs(Math.log(f.w[i] / f.h[i] / this.aspects[i]));
      area += Math.log((f.w[i] * f.h[i]) / totalArea / this.targetAreas[i]) ** 2;
    }
    return (crop + this.areaWeight * area) / n;
  }

  cells(t, photos) {
    const f = this.frames(t);
    if (!f) return [];
    return photos.map((photo, i) => makeCell({
      x: f.x[i] / this.width,
      y: f.y[i] / this.height,
      w: f.w[i] / this.width,
      h: f.h[i] / this.height,
    }, photo.id));
  }
}
