import { uid } from '../util.js';

export const MAX_PHOTOS = 100;

/**
 * 編集画面に表示する縮小画像の長辺 (ピクセル)。
 * 枚数が多いほど 1 枚あたりの表示は小さいので、メモリを節約するため小さくする。
 */
export function previewMaxPixel(photoCount) {
  if (photoCount < 16) return 1200;
  if (photoCount < 41) return 900;
  return 640;
}

/**
 * 画像を読み込んでデコードする。EXIF の向きは <img> の既定動作 (image-orientation: from-image) で適用される。
 * 使い終わったら release() を呼ぶ。
 */
export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  // img.decode() はページが非表示 (別のアプリやタブに切り替え中) だと表示されるまで待たされるので、
  // 読み込み完了のイベントで待つ。デコードは描画時に行われる。
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('画像を読み込めません'));
      img.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    img.onload = img.onerror = null;
  }
  return { img, url, release: () => URL.revokeObjectURL(url) };
}

/**
 * 写真 1 枚分を作る。元画像は Blob のまま保持し (書き出し時に読み直す)、表示には縮小版を使う。
 * @returns {{id, name, blob, width, height, aspect, preview: HTMLImageElement, previewURL: string}}
 */
export async function makePhoto(blob, { id = uid(), name = '', maxPixel }) {
  const original = await loadImage(blob);
  try {
    const width = original.img.naturalWidth;
    const height = original.img.naturalHeight;
    if (!width || !height) throw new Error('画像の大きさを取得できません');

    const scale = Math.min(1, maxPixel / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(original.img, 0, 0, canvas.width, canvas.height);
    // 透過のある形式は PNG のまま縮小する (JPEG にすると透明部分が黒くなる)
    const opaque = /jpe?g|hei[cf]/i.test(blob.type);
    const previewBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, opaque ? 'image/jpeg' : 'image/png', 0.9));
    canvas.width = canvas.height = 0; // メモリを早めに解放する
    if (!previewBlob) throw new Error('縮小画像を作れません');

    const preview = await loadImage(previewBlob);
    return {
      id, name, blob, width, height,
      aspect: width / height,
      preview: preview.img,
      previewURL: preview.url,
    };
  } finally {
    original.release();
    original.img.src = '';
  }
}

/** 選ばれたファイルを順番に読み込む。読み込めなかったファイルは飛ばして数だけ返す。 */
export async function loadPhotoFiles(files, maxPixel, onProgress) {
  const photos = [];
  let failed = 0;
  for (const [index, file] of files.entries()) {
    try {
      photos.push(await makePhoto(file, { name: file.name, maxPixel }));
    } catch (error) {
      failed += 1;
      console.warn('読み込めない写真', file.name, error);
    }
    onProgress?.(index + 1, files.length);
  }
  return { photos, failed };
}

export function isImageFile(file) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|hei[cf]|avif|bmp)$/i.test(file.name);
}
