import { uid } from '../util.js';

/**
 * キャンバス上の 1 区画と、そこに入る写真。
 * - rect: 写真領域に対する正規化座標 (0...1)
 * - zoom: セルを埋める最小倍率を 1 とした拡大率 (>= 1)
 * - offset: 表示位置のずれ。セルの幅・高さを 1 とした単位。
 */
export function makeCell(rect, photoId) {
  return { id: uid(), rect, photoId, zoom: 1, offset: { x: 0, y: 0 } };
}
