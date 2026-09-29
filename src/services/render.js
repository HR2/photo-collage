import { alignRect, imageRect, titleFontCSS } from '../model/geometry.js';

/*
 * コラージュの描画。画面表示 (縮小画像) と書き出し (元画像) で同じ関数を使い、見た目を一致させる。
 */

/** タイトルの帯の中央に 1 行で描く */
export function drawTitle(ctx, geometry, color, scale) {
  if (!geometry.hasTitle) return;
  const band = geometry.titleRect;
  ctx.save();
  ctx.font = titleFontCSS(geometry.titleFont, geometry.fittedTitleFontSize * scale);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(geometry.title, (band.x + band.w / 2) * scale, (band.y + band.h / 2) * scale);
  ctx.restore();
}

/** セル 1 つ分。CropGeometry と同じ計算で画像の位置を決めて切り抜く。 */
export function drawCellImage(ctx, source, imageAspect, frame, zoom, offset, alpha = 1) {
  const r = imageRect(imageAspect, frame, zoom, offset);
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.w, frame.h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(source, r.x, r.y, r.w, r.h);
  ctx.restore();
}

/**
 * 縮小画像でコラージュ全体を描く (画面表示用)。ctx は表示ピクセル単位に変換済みであること。
 * @param {object} options
 * @param {number} options.scale 表示倍率 (表示ピクセル / 出力ピクセル)
 * @param {Array} [options.cells] 表示するセル。省略するとプロジェクトの現在のレイアウト。
 * @param {(cell) => {zoom, offset}} [options.cropFor] ジェスチャー中の値を反映した拡大率と位置
 * @param {string} [options.dimmedId] 入れ替えのために持ち上げているセル
 * @param {string} [options.dropTargetId] 入れ替え先の候補のセル
 * @param {number} [options.pixelRatio] セルの境界をデバイスピクセルに揃えるための倍率
 */
export function drawCollage(ctx, project, {
  scale, cells = project.cells, cropFor, dimmedId, dropTargetId, accent = '#0a84ff', pixelRatio = 1,
}) {
  const geometry = project.frameGeometry;
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, project.canvasW * scale, project.canvasH * scale);
  drawTitle(ctx, geometry, project.titleColor, scale);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const cell of cells) {
    const photo = project.photo(cell.photoId);
    if (!photo) continue;
    const frame = alignRect(geometry.cellFrame(cell, project.spacing, scale), pixelRatio);
    const crop = cropFor?.(cell) ?? cell;
    drawCellImage(ctx, photo.preview, photo.aspect, frame, crop.zoom, crop.offset,
      cell.id === dimmedId ? 0.3 : 1);
    if (cell.id === dropTargetId) {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.strokeRect(frame.x + 2, frame.y + 2, frame.w - 4, frame.h - 4);
      ctx.restore();
    }
  }
}

/** 要素の大きさに合わせてキャンバスの解像度を設定し、表示ピクセル単位で描ける状態にする */
export function prepareCanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, dpr };
}
