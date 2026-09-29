import { alignRect } from '../model/geometry.js';
import { loadImage } from './images.js';
import { drawCellImage, drawTitle } from './render.js';

/**
 * 出力画像の総ピクセル数の上限。
 * iPhone / iPad の Safari はこれを超えるキャンバスを作れない (約 4096 × 4096)。
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export const EXPORT_FORMATS = [
  { id: 'jpeg', title: 'JPEG', mime: 'image/jpeg', ext: 'jpg' },
  { id: 'png', title: 'PNG', mime: 'image/png', ext: 'png' },
];

function timestamp(date = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * 指定したピクセルサイズでコラージュを描画し、画像ファイル (Blob) にする。
 * 写真はセルごとに元画像を読み直して描くので、縮小版より高い解像度で出力できる。
 */
export async function exportCollage(project, formatId, onProgress) {
  const format = EXPORT_FORMATS.find((f) => f.id === formatId) ?? EXPORT_FORMATS[0];
  const geometry = project.frameGeometry;
  const width = Math.round(project.canvasW);
  const height = Math.round(project.canvasH);
  if (width * height > MAX_CANVAS_PIXELS) {
    throw new Error('出力サイズが大きすぎるため書き出せません。');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('画像の書き出しに失敗しました。');

  try {
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawTitle(ctx, geometry, project.titleColor, 1);

    const cells = project.cells;
    for (const [index, cell] of cells.entries()) {
      const photo = project.photo(cell.photoId);
      if (photo) {
        // セルの境界を整数ピクセルに揃え、隣のセルとの間に半端な隙間や重なりが出ないようにする
        const frame = alignRect(geometry.cellFrame(cell, project.spacing, 1), 1);
        const source = await loadImage(photo.blob);
        try {
          drawCellImage(ctx, source.img, photo.aspect, frame, cell.zoom, cell.offset);
        } finally {
          source.release();
          source.img.src = '';
        }
      }
      onProgress?.(index + 1, cells.length);
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, format.mime, 0.92));
    if (!blob) throw new Error('画像の書き出しに失敗しました。');
    return {
      blob,
      width,
      height,
      fileName: `Collage_${timestamp()}.${format.ext}`,
    };
  } finally {
    canvas.width = canvas.height = 0; // 大きなキャンバスのメモリを早めに解放する
  }
}
