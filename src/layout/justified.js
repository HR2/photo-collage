import { makeRng, shuffle } from './random.js';
import { makeCell } from './cell.js';

/**
 * A: 行ごとに揃えるレイアウト (Justified)。
 *
 * 写真を行に分け、同じ行の写真は高さを揃えて幅いっぱいに並べる。
 * 行の高さの合計がキャンバスの高さに合い、かつ各行の高さが揃うように、
 * どの写真をどの行に入れるかを探索する。
 * 残った誤差は行の高さを一律に伸縮して吸収する (その分は写真側のトリミングになる)。
 */
export function justifiedLayout(photos, canvas, spacing, seed, { balanceWeight = 0.5, maxRowRatio = 2 } = {}) {
  if (!photos.length || canvas.w <= 0 || canvas.h <= 0) return [];

  const order = photos.slice();
  if (seed !== 0) shuffle(order, makeRng(seed));

  // 行の高さの上限を満たす案がなければ、上限なしで探し直す
  for (const ratio of [maxRowRatio, Infinity]) {
    const solver = new Solver(order.map((p) => Math.max(p.aspect, 0.01)), canvas.w, canvas.h,
      Math.max(spacing, 0), balanceWeight, ratio);
    const rows = solver.solve();
    if (rows) return solver.makeCells(rows, order);
  }
  return [];
}

const sum = (list) => list.reduce((s, v) => s + v, 0);

class Solver {
  constructor(aspects, width, height, spacing, balanceWeight, maxRowRatio) {
    Object.assign(this, { aspects, width, height, spacing, balanceWeight, maxRowRatio });
    this.n = aspects.length;
  }

  /** 自然な行の高さ (幅いっぱいに並べたときの高さ)。並べられなければ null */
  rowHeight(count, aspectSum) {
    const usable = this.width - this.spacing * (count - 1);
    if (count <= 0 || usable <= 0) return null;
    return usable / aspectSum;
  }

  /** 評価値 (小さいほど良い) = トリミング量 + 行の高さのばらつき。stats は [{count, aspectSum}] */
  score(stats) {
    const available = this.height - this.spacing * (stats.length - 1);
    if (available <= 0) return Infinity;
    const heights = [];
    for (const row of stats) {
      const h = this.rowHeight(row.count, row.aspectSum);
      if (h == null) return Infinity;
      heights.push(h);
    }
    // 最も高い行と低い行の差が大きすぎる案は採用しない
    if (Math.max(...heights) / Math.min(...heights) > this.maxRowRatio) return Infinity;
    // 全行を一律 f 倍して高さを合わせる → 全写真の比率が f だけずれる
    const f = available / sum(heights);
    const crop = this.n * Math.abs(Math.log(f));
    const mean = available / stats.length;
    let balance = 0;
    stats.forEach((row, i) => { balance += row.count * Math.log((heights[i] * f) / mean) ** 2; });
    return crop + this.balanceWeight * balance;
  }

  solve() {
    // 行数の目安: 行の高さ t で R 行 → R·t ≈ H, R·W/t ≈ Σaspect
    const estimate = Math.sqrt((sum(this.aspects) * this.height) / this.width);
    const lower = Math.max(1, Math.floor(estimate / 2));
    const upper = Math.max(lower, Math.min(this.n, Math.ceil(estimate * 2) + 1));

    let best = null;
    for (let rowCount = lower; rowCount <= upper; rowCount++) {
      const initial = this.orderedPartition(rowCount);
      if (!initial) continue;
      const result = this.improve(initial);
      if (result.score < (best?.score ?? Infinity)) best = result;
    }
    // 行内・行間とも元の順番をなるべく保つ
    return best?.rows
      .map((row) => row.slice().sort((a, b) => a - b))
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)) ?? null;
  }

  /** 初期解: 順番を保ったまま、各行の高さが目標値に近くなる分け方を動的計画法で求める */
  orderedPartition(rows) {
    const n = this.n;
    const available = this.height - this.spacing * (rows - 1);
    if (available <= 0 || rows > n) return null;
    const target = available / rows;
    const prefix = [0];
    for (const a of this.aspects) prefix.push(prefix[prefix.length - 1] + a);

    const dp = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(-1));
    dp[0][0] = 0;
    for (let r = 1; r <= rows; r++) {
      for (let j = r; j <= n - (rows - r); j++) {
        for (let i = r - 1; i < j; i++) {
          if (dp[r - 1][i] === Infinity) continue;
          const h = this.rowHeight(j - i, prefix[j] - prefix[i]);
          if (h == null) continue;
          const c = dp[r - 1][i] + Math.log(h / target) ** 2;
          if (c < dp[r][j]) {
            dp[r][j] = c;
            from[r][j] = i;
          }
        }
      }
    }
    if (dp[rows][n] === Infinity) return null;
    const bounds = [n];
    let j = n;
    for (let r = rows; r > 0; r--) {
      j = from[r][j];
      bounds.push(j);
    }
    bounds.reverse();
    return Array.from({ length: rows }, (_, r) => {
      const row = [];
      for (let k = bounds[r]; k < bounds[r + 1]; k++) row.push(k);
      return row;
    });
  }

  /** 局所探索: 写真を別の行へ移す / 2 枚を行どうしで交換する操作を、評価値が下がる限り繰り返す */
  improve(initial) {
    const { aspects } = this;
    const rows = initial.map((row) => row.slice());
    let stats = rows.map((row) => ({ count: row.length, aspectSum: sum(row.map((i) => aspects[i])) }));
    let current = this.score(stats);
    const rowCount = rows.length;
    if (rowCount <= 1) return { rows, score: current };
    const copy = (s) => s.map((row) => ({ count: row.count, aspectSum: row.aspectSum }));

    for (let iteration = 0; iteration < 100; iteration++) {
      let improved = false;

      // 移動
      for (let r = 0; r < rowCount; r++) {
        if (rows[r].length <= 1) continue;
        let k = 0;
        while (k < rows[r].length) {
          const photo = rows[r][k];
          const a = aspects[photo];
          let bestMove = null;
          for (let q = 0; q < rowCount; q++) {
            if (q === r) continue;
            const trial = copy(stats);
            trial[r].count -= 1; trial[r].aspectSum -= a;
            trial[q].count += 1; trial[q].aspectSum += a;
            const s = this.score(trial);
            if (s < (bestMove?.score ?? current) - 1e-9) bestMove = { q, score: s };
          }
          if (bestMove && rows[r].length > 1) {
            rows[r].splice(k, 1);
            rows[bestMove.q].push(photo);
            stats[r].count -= 1; stats[r].aspectSum -= a;
            stats[bestMove.q].count += 1; stats[bestMove.q].aspectSum += a;
            current = bestMove.score;
            improved = true;
          } else {
            k += 1;
          }
        }
      }

      // 交換
      for (let r = 0; r < rowCount; r++) {
        for (let q = r + 1; q < rowCount; q++) {
          for (let i = 0; i < rows[r].length; i++) {
            for (let j = 0; j < rows[q].length; j++) {
              const d = aspects[rows[q][j]] - aspects[rows[r][i]];
              if (Math.abs(d) <= 1e-6) continue;
              const trial = copy(stats);
              trial[r].aspectSum += d;
              trial[q].aspectSum -= d;
              const s = this.score(trial);
              if (s < current - 1e-9) {
                [rows[r][i], rows[q][j]] = [rows[q][j], rows[r][i]];
                stats = trial;
                current = s;
                improved = true;
              }
            }
          }
        }
      }

      if (!improved) break;
    }
    return { rows, score: current };
  }

  makeCells(rows, photos) {
    const { aspects, width, height, spacing } = this;
    const available = height - spacing * (rows.length - 1);
    const natural = rows.map((row) => this.rowHeight(row.length, sum(row.map((i) => aspects[i]))) ?? 0);
    const f = available / sum(natural);

    const cells = [];
    let y = 0;
    rows.forEach((row, r) => {
      const h = r === rows.length - 1 ? height - y : natural[r] * f;
      let x = 0;
      row.forEach((i, k) => {
        // 幅は行の自然な高さで決まる (合計が width - 間隔 になる)
        const w = k === row.length - 1 ? width - x : aspects[i] * natural[r];
        cells.push(makeCell({ x: x / width, y: y / height, w: w / width, h: h / height }, photos[i].id));
        x += w + spacing;
      });
      y += h + spacing;
    });
    return cells;
  }
}
