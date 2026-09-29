import { computeLayout } from './index.js';

/*
 * レイアウト計算をワーカーに振り分ける。3 方式を同時に計算できるよう 3 つ用意する。
 * ワーカーが使えない環境 (モジュールワーカー非対応など) ではメインスレッドで計算する。
 */

const POOL_SIZE = 3;
let workers = null;
let nextId = 1;
const pending = new Map(); // id → { job, worker, resolve, reject }

function computeNow(job) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(computeLayout(job.kind, job.photos, job.canvas, job.seed)), 0);
  });
}

function pool() {
  if (workers) return workers;
  workers = [];
  if (typeof Worker === 'undefined') return workers;
  for (let i = 0; i < POOL_SIZE; i++) {
    let worker;
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch {
      break;
    }
    worker.load = 0;
    worker.onmessage = (event) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      worker.load -= 1;
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.cells);
    };
    worker.onerror = (event) => {
      // 読み込みに失敗したワーカーは外し、担当分はメインスレッドで計算する
      event.preventDefault?.();
      workers = workers.filter((w) => w !== worker);
      for (const [id, entry] of pending) {
        if (entry.worker !== worker) continue;
        pending.delete(id);
        computeNow(entry.job).then(entry.resolve, entry.reject);
      }
      worker.terminate();
    };
    workers.push(worker);
  }
  return workers;
}

/** @returns {Promise<Cell[]>} */
export function requestLayout(kind, photos, canvas, seed) {
  const job = { kind, photos, canvas, seed };
  const available = pool();
  if (!available.length) return computeNow(job);
  const worker = available.reduce((a, b) => (a.load <= b.load ? a : b));
  worker.load += 1;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { job, worker, resolve, reject });
    worker.postMessage({ id, ...job });
  });
}
