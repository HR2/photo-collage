import { frameOf } from '../model/geometry.js';
import { justifiedLayout } from './justified.js';
import { slicingLayout } from './slicing.js';

/*
 * レイアウト方式の共通インターフェース:
 *   (photos: [{id, aspect, weight}], canvas: {w, h}, spacing, seed) → Cell[]
 * 出力は正規化座標のセル一覧なので、表示・編集・書き出しは方式に関係なく共通で扱える。
 * seed は同じ方式で別の案を作るための乱数の種。0 は既定の案。
 */

export const LAYOUT_KINDS = [
  { id: 'justified', title: 'A 行揃え', summary: '同じ行の写真の高さを揃えて並べます' },
  { id: 'guillotine', title: 'B 分割ツリー', summary: '縦横の分割を組み合わせ、トリミングを最小にします' },
  { id: 'featured', title: 'C メリハリ', summary: '主役の写真を大きく、ほかを小さく配置します' },
];

export const layoutTitle = (id) => LAYOUT_KINDS.find((k) => k.id === id)?.title ?? '';

export function computeLayout(kind, photos, canvas, seed) {
  switch (kind) {
    case 'guillotine': return slicingLayout(photos, canvas, 0, seed, 'uniform');
    case 'featured': return slicingLayout(photos, canvas, 0, seed, 'featured');
    default: return justifiedLayout(photos, canvas, 0, seed);
  }
}

/** トリミングで失われる面積の割合の平均 (0...1) */
export function averageCropLoss(cells, aspectById, canvas) {
  if (!cells.length) return 0;
  let total = 0;
  for (const cell of cells) {
    const photoAspect = aspectById.get(cell.photoId);
    if (photoAspect == null) continue;
    const f = frameOf(cell.rect, canvas);
    if (f.h <= 0) continue;
    const cellAspect = f.w / f.h;
    total += 1 - Math.min(cellAspect, photoAspect) / Math.max(cellAspect, photoAspect);
  }
  return total / cells.length;
}
