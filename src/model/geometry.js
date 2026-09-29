import { clamp } from '../util.js';

// 矩形はすべて { x, y, w, h }、大きさは { w, h }、ずれは { x, y } で表す。

const EDGE = 0.0001;

/**
 * 正規化座標 (0...1) の矩形を実際の座標 (表示 or 出力ピクセル) に変換する。
 * spacing を指定すると、キャンバスの外周以外の辺を spacing / 2 ずつ内側に縮める
 * (隣り合うセルの間に spacing の隙間ができる)。
 */
export function frameOf(rect, size, spacing = 0) {
  const half = Math.max(spacing, 0) / 2;
  const maxXn = rect.x + rect.w;
  const maxYn = rect.y + rect.h;
  const minX = rect.x * size.w + (rect.x > EDGE ? half : 0);
  const minY = rect.y * size.h + (rect.y > EDGE ? half : 0);
  const maxX = maxXn * size.w - (maxXn < 1 - EDGE ? half : 0);
  const maxY = maxYn * size.h - (maxYn < 1 - EDGE ? half : 0);
  return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
}

export const containsPoint = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** 境界を 1/k 単位に揃え、隣のセルとの間に半端な隙間や重なりが出ないようにする */
export function alignRect(r, k = 1) {
  const f = (v) => Math.round(v * k) / k;
  const x = f(r.x), y = f(r.y);
  return { x, y, w: f(r.x + r.w) - x, h: f(r.y + r.h) - y };
}

// MARK: セル内での写真の配置 (画面表示と書き出しで同じ計算を使い、見た目を一致させる)

/** セルを隙間なく埋める (aspect fill) 画像の大きさ。セルの幅・高さを 1 とした単位。 */
export function fillScale(imageAspect, cellAspect, zoom) {
  const z = Math.max(zoom, 1);
  return imageAspect > cellAspect
    ? { w: (imageAspect / cellAspect) * z, h: z }
    : { w: z, h: (cellAspect / imageAspect) * z };
}

/** 画像の端がセルの内側に入らない範囲にずれを制限する */
export function clampedOffset(offset, imageAspect, cellAspect, zoom) {
  const fill = fillScale(imageAspect, cellAspect, zoom);
  const maxX = (fill.w - 1) / 2;
  const maxY = (fill.h - 1) / 2;
  return { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) };
}

/** セル (実座標) の中に描く画像の矩形 (同じ座標系) */
export function imageRect(imageAspect, cell, zoom, offset) {
  if (cell.w <= 0 || cell.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const cellAspect = cell.w / cell.h;
  const fill = fillScale(imageAspect, cellAspect, zoom);
  const o = clampedOffset(offset, imageAspect, cellAspect, zoom);
  const w = fill.w * cell.w;
  const h = fill.h * cell.h;
  return {
    x: cell.x + cell.w / 2 - w / 2 + o.x * cell.w,
    y: cell.y + cell.h / 2 - h / 2 + o.y * cell.h,
    w,
    h,
  };
}

// MARK: タイトル

export const TITLE_FONTS = [
  { id: 'gothic', title: 'ゴシック', css: (s) => `700 ${s}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif` },
  { id: 'mincho', title: '明朝', css: (s) => `600 ${s}px "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", serif` },
  { id: 'rounded', title: '丸ゴシック', css: (s) => `700 ${s}px "Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", ui-rounded, "Arial Rounded MT Bold", sans-serif` },
];

export function titleFontCSS(id, size) {
  return (TITLE_FONTS.find((f) => f.id === id) ?? TITLE_FONTS[0]).css(size);
}

let measureContext = null;
function measureTextWidth(text, font) {
  measureContext ??= document.createElement('canvas').getContext('2d');
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/** 縁・タイトルを含めたキャンバスの区画割り。画面表示と書き出しで同じ計算を使う。 */
export class FrameGeometry {
  constructor({ canvasW, canvasH, border, title, titleFont, titleFontSize }) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.border = border;
    this.title = title;
    this.titleFont = titleFont;
    this.titleFontSize = titleFontSize;
  }

  get hasTitle() { return this.title.trim().length > 0; }

  /** タイトルの帯の高さ (ピクセル)。文字の上下に余白をとる。 */
  get titleBandHeight() { return this.hasTitle ? Math.round(this.titleFontSize * 1.8) : 0; }

  get clampedBorder() {
    return clamp(this.border, 0, Math.min(this.canvasW, this.canvasH) / 4);
  }

  /** タイトルの帯 (ピクセル座標) */
  get titleRect() {
    const b = this.clampedBorder;
    return { x: b, y: b, w: this.canvasW - 2 * b, h: this.titleBandHeight };
  }

  /** 写真を並べる領域 (ピクセル座標) */
  get contentRect() {
    const b = this.clampedBorder;
    const top = b + this.titleBandHeight;
    return {
      x: b,
      y: top,
      w: Math.max(this.canvasW - 2 * b, 1),
      h: Math.max(this.canvasH - top - b, 1),
    };
  }

  /** 帯の幅に収まるよう縮めた文字の大きさ (ピクセル) */
  get fittedTitleFontSize() {
    const maxWidth = this.titleRect.w * 0.94;
    const width = measureTextWidth(this.title, titleFontCSS(this.titleFont, this.titleFontSize));
    if (width <= maxWidth || width <= 0) return this.titleFontSize;
    return (this.titleFontSize * maxWidth) / width;
  }

  /** セルの矩形を、表示倍率 scale (表示ピクセル / 出力ピクセル) の座標に変換する */
  cellFrame(cell, spacing, scale) {
    const content = this.contentRect;
    const f = frameOf(cell.rect, { w: content.w * scale, h: content.h * scale }, spacing * scale);
    return { x: f.x + content.x * scale, y: f.y + content.y * scale, w: f.w, h: f.h };
  }
}

export function fittedSize(canvas, box) {
  if (canvas.w <= 0 || canvas.h <= 0 || box.w <= 0 || box.h <= 0) return { w: 0, h: 0 };
  const scale = Math.min(box.w / canvas.w, box.h / canvas.h);
  return { w: canvas.w * scale, h: canvas.h * scale };
}
