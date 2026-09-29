import { clamp } from '../util.js';
import { clampedOffset, frameOf, FrameGeometry } from './geometry.js';
import { averageCropLoss, LAYOUT_KINDS } from '../layout/index.js';
import { requestLayout } from '../layout/client.js';
import { newSeed } from '../layout/random.js';
import { FEATURED_WEIGHT } from '../layout/slicing.js';
import { makePhoto, previewMaxPixel } from '../services/images.js';
import * as store from '../services/store.js';

/** セルの拡大率の上限 */
export const MAX_ZOOM = 5;
/** 取り消せる操作の数 */
const UNDO_LIMIT = 100;

const copyCells = (cells) => cells.map((c) => ({ ...c, rect: { ...c.rect }, offset: { ...c.offset } }));
const sameCells = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 編集中のコラージュ全体の状態。
 * 値を変えたら changed() で購読者 (画面) に知らせる。セルの配列は差し替えで更新し、中身は書き換えない。
 */
export class Project {
  constructor(canvasW, canvasH, photos) {
    /** 出力画像のピクセルサイズ */
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.photos = photos;
    this.cells = [];

    this.layoutKind = 'justified';
    this.layoutSeed = 0;
    /** 写真どうしの間隔 (出力画像のピクセル)。レイアウトとは独立に、描画時にセルを縮めて付ける。 */
    this.spacing = 0;
    /** 背景・縁・間隔の色 */
    this.background = '#ffffff';
    /** 外周の縁の太さ (出力画像のピクセル) */
    this.border = 0;
    /** 上部のタイトル。空なら帯を付けない。 */
    this.title = '';
    this.titleFont = 'gothic';
    /** タイトルの文字の大きさ (出力画像のピクセル) */
    this.titleFontSize = Math.round(Math.min(canvasW, canvasH) * 0.06);
    this.titleColor = '#333333';
    /** C (メリハリ型) で大きく配置する「主役」の写真 */
    this.featuredIds = new Set();

    this.photoById = new Map(photos.map((p) => [p.id, p]));
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(what) {
    for (const listener of this.listeners) listener(what);
  }

  /** 設定値を変える (取り消しの対象外) */
  set(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    this.changed(key);
  }

  photo(id) { return this.photoById.get(id); }

  /** 縁・タイトルを含めた区画割り */
  get frameGeometry() {
    return new FrameGeometry({
      canvasW: this.canvasW, canvasH: this.canvasH, border: this.border,
      title: this.title, titleFont: this.titleFont, titleFontSize: this.titleFontSize,
    });
  }

  /** 写真を並べる領域のピクセルサイズ */
  get contentSize() {
    const r = this.frameGeometry.contentRect;
    return { w: r.w, h: r.h };
  }

  get photoInfos() {
    return this.photos.map((p) => ({
      id: p.id, aspect: p.aspect, weight: this.featuredIds.has(p.id) ? FEATURED_WEIGHT : 1,
    }));
  }

  // MARK: レイアウト

  /** レイアウトをバックグラウンドで計算する (B・C は探索に時間がかかるため) */
  computeLayout(kind, seed) {
    return requestLayout(kind, this.photoInfos, this.contentSize, seed);
  }

  /** 見比べ画面で選んだ案を採用する。編集の履歴はリセットする。 */
  apply(kind, seed, cells) {
    this.layoutKind = kind;
    this.layoutSeed = seed;
    this.cells = cells;
    this.undoStack = [];
    this.redoStack = [];
    this.changed('cells');
  }

  /** 現在の方式・seed でレイアウトを計算し直す (取り消し可能) */
  async relayout() {
    const kind = this.layoutKind, seed = this.layoutSeed;
    const result = await this.computeLayout(kind, seed);
    // 計算中に設定が変わっていたら結果は捨てる
    if (kind !== this.layoutKind || seed !== this.layoutSeed) return;
    this.updateCells(result);
  }

  /** 同じ方式で別の案を作る */
  async shuffleLayout() {
    this.layoutSeed = newSeed();
    await this.relayout();
  }

  /** 最初の案に戻す */
  async resetLayout() {
    this.layoutSeed = 0;
    await this.relayout();
  }

  // MARK: 編集

  /** 2 つのセルの写真を入れ替える。セルの形はそのまま。 */
  swapPhotos(a, b) {
    if (a === b) return;
    const i = this.cells.findIndex((c) => c.id === a);
    const j = this.cells.findIndex((c) => c.id === b);
    if (i < 0 || j < 0) return;
    const next = copyCells(this.cells);
    [next[i].photoId, next[j].photoId] = [next[j].photoId, next[i].photoId];
    // 形の違うセルに移るので、拡大と位置はリセットする
    for (const k of [i, j]) {
      next[k].zoom = 1;
      next[k].offset = { x: 0, y: 0 };
    }
    this.updateCells(next);
  }

  /** 拡大率と位置を、隙間ができない範囲に収める */
  clampCrop(cellId, zoom, offset) {
    const cell = this.cells.find((c) => c.id === cellId);
    const photo = cell && this.photo(cell.photoId);
    if (!photo) return { zoom: 1, offset: { x: 0, y: 0 } };
    const frame = frameOf(cell.rect, this.contentSize, this.spacing);
    const z = clamp(zoom, 1, MAX_ZOOM);
    return { zoom: z, offset: clampedOffset(offset, photo.aspect, frame.w / frame.h, z) };
  }

  /** セル内の写真の拡大率と位置を設定する */
  setCrop(cellId, zoom, offset) {
    const i = this.cells.findIndex((c) => c.id === cellId);
    if (i < 0) return;
    const crop = this.clampCrop(cellId, zoom, offset);
    const next = copyCells(this.cells);
    next[i].zoom = crop.zoom;
    next[i].offset = crop.offset;
    this.updateCells(next);
  }

  resetCrop(cellId) {
    this.setCrop(cellId, 1, { x: 0, y: 0 });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.cells);
    this.cells = previous;
    this.changed('cells');
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.cells);
    this.cells = next;
    this.changed('cells');
  }

  updateCells(next) {
    if (sameCells(next, this.cells)) return;
    this.undoStack.push(this.cells);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.cells = next;
    this.changed('cells');
  }

  // MARK: 情報

  averageCropLoss(cells = this.cells) {
    const aspects = new Map(this.photos.map((p) => [p.id, p.aspect]));
    return averageCropLoss(cells, aspects, this.contentSize);
  }

  // MARK: 保存と再開

  toJSON() {
    return {
      version: 1,
      canvasW: this.canvasW,
      canvasH: this.canvasH,
      photos: this.photos.map((p) => ({ id: p.id, name: p.name, width: p.width, height: p.height })),
      cells: this.cells,
      layoutKind: this.layoutKind,
      layoutSeed: this.layoutSeed,
      spacing: this.spacing,
      background: this.background,
      featuredIds: [...this.featuredIds],
      border: this.border,
      title: this.title,
      titleFont: this.titleFont,
      titleFontSize: this.titleFontSize,
      titleColor: this.titleColor,
      savedAt: new Date().toISOString(),
    };
  }

  /** 変更をまとめて自動保存する */
  save() {
    store.scheduleSave(() => this.toJSON());
  }

  /** 保存済みのプロジェクトを読み込む。写真が欠けていれば null。 */
  static async restore(saved, onProgress) {
    const maxPixel = previewMaxPixel(saved.photos.length);
    const photos = [];
    for (const [index, info] of saved.photos.entries()) {
      const blob = await store.getPhotoBlob(info.id);
      if (!blob) return null;
      try {
        photos.push(await makePhoto(blob, { id: info.id, name: info.name, maxPixel }));
      } catch {
        return null;
      }
      onProgress?.(index + 1, saved.photos.length);
    }
    if (!photos.length) return null;

    const project = new Project(saved.canvasW, saved.canvasH, photos);
    project.layoutKind = LAYOUT_KINDS.some((k) => k.id === saved.layoutKind) ? saved.layoutKind : 'justified';
    project.layoutSeed = saved.layoutSeed ?? 0;
    project.cells = (saved.cells ?? []).filter((c) => project.photoById.has(c.photoId));
    project.spacing = saved.spacing ?? 0;
    project.background = saved.background ?? '#ffffff';
    project.featuredIds = new Set(saved.featuredIds ?? []);
    project.border = saved.border ?? 0;
    project.title = saved.title ?? '';
    project.titleFont = saved.titleFont ?? 'gothic';
    if (saved.titleFontSize) project.titleFontSize = saved.titleFontSize;
    if (saved.titleColor) project.titleColor = saved.titleColor;
    return project;
  }
}
