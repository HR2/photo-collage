import { computeLayout } from './index.js';

// B・C は探索に時間がかかるため、画面を止めないようワーカーで計算する
self.onmessage = (event) => {
  const { id, kind, photos, canvas, seed } = event.data;
  try {
    self.postMessage({ id, cells: computeLayout(kind, photos, canvas, seed) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
