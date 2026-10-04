import { h, icon } from '../util.js';
import { Project } from '../model/project.js';
import { layoutTitle } from '../layout/index.js';
import { isImageFile, loadPhotoFiles, MAX_PHOTOS, previewMaxPixel } from '../services/images.js';
import { MAX_CANVAS_PIXELS } from '../services/exporter.js';
import * as store from '../services/store.js';
import { alertDialog, button, showLoading, topBar } from './common.js';
import { createCompareScreen } from './compare.js';

const SIZE_RANGE = [100, 16000];

const SIZE_PRESETS = [
  { name: '横長 3:2', width: 3000, height: 2000 },
  { name: '縦長 2:3', width: 2000, height: 3000 },
  { name: '正方形', width: 2048, height: 2048 },
  { name: '4K 16:9', width: 3840, height: 2160 },
  { name: 'A4 縦 300dpi', width: 2480, height: 3508 },
  { name: 'A4 横 300dpi', width: 3508, height: 2480 },
  { name: 'SNS 縦 4:5', width: 1080, height: 1350 },
];

/** 最初の画面: 出力サイズを決めて写真を選ぶ */
export function createSetupScreen(nav) {
  let width = 3000;
  let height = 2000;
  let saved = null;
  let busy = false;

  // MARK: 前回の続き

  const resumeInfo = h('div', { class: 'resume-info' });
  const resumeButton = button('続きから編集', { variant: 'primary', onClick: () => resume() });
  const resumeCard = h('section', { class: 'card', hidden: true },
    h('h2', { class: 'card-title' }, '前回の続き'),
    h('div', { class: 'resume-row' }, resumeInfo, resumeButton));

  // MARK: 出力サイズ

  const presetButtons = SIZE_PRESETS.map((preset) => {
    const el = h('button', {
      type: 'button', class: 'preset',
      onClick: () => { width = preset.width; height = preset.height; render(); },
    }, h('span', { class: 'preset-name' }, preset.name),
    h('span', { class: 'preset-size' }, `${preset.width}×${preset.height}`));
    return { el, preset };
  });

  const sizeInput = (label, get, set) => {
    const input = h('input', {
      type: 'number', inputmode: 'numeric', min: SIZE_RANGE[0], max: SIZE_RANGE[1], step: 1, 'aria-label': label,
    });
    input.addEventListener('input', () => { set(Math.round(Number(input.value)) || 0); render({ keepInputs: true }); });
    return { input, el: h('label', { class: 'size-field' }, h('span', {}, label), input), sync: () => { input.value = get(); } };
  };
  const widthField = sizeInput('幅', () => width, (v) => { width = v; });
  const heightField = sizeInput('高さ', () => height, (v) => { height = v; });
  const swapButton = button('', {
    iconName: 'swap', title: '幅と高さを入れ替え',
    onClick: () => { [width, height] = [height, width]; render(); },
  });

  const sizeError = h('p', { class: 'error-text', hidden: true });
  const shapeBox = h('div', { class: 'shape-box' });
  const shapeLabel = h('span', {});
  shapeBox.append(shapeLabel);

  // MARK: 写真の選択

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) loadPhotos(files);
  });
  const pickButton = h('button', { type: 'button', class: 'btn primary large', onClick: () => fileInput.click() },
    icon('photos'), h('span', {}, '写真を選んでコラージュを作成'));
  const dropZone = h('section', { class: 'card drop-zone' },
    pickButton,
    h('p', { class: 'caption' }, 'またはここに写真をドラッグ＆ドロップ'),
    fileInput);
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (isValidSize() && !busy) dropZone.classList.add('dragging');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length && isValidSize() && !busy) loadPhotos(files);
  });
  const footer = h('p', { class: 'footnote' });

  const el = h('div', { class: 'screen' },
    topBar('フォトコラージュ'),
    h('main', { class: 'screen-body' },
      h('div', { class: 'setup' },
        resumeCard,
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, '出力サイズ (ピクセル)'),
          h('div', { class: 'preset-grid' }, presetButtons.map((p) => p.el)),
          h('div', { class: 'size-row' }, widthField.el, swapButton, heightField.el),
          sizeError,
          h('div', { class: 'shape-preview' }, shapeBox)),
        dropZone,
        footer)));

  function isValidSize() {
    const inRange = (v) => v >= SIZE_RANGE[0] && v <= SIZE_RANGE[1];
    return inRange(width) && inRange(height) && width * height <= MAX_CANVAS_PIXELS;
  }

  function render({ keepInputs = false } = {}) {
    for (const { el: b, preset } of presetButtons) {
      b.classList.toggle('selected', preset.width === width && preset.height === height);
    }
    if (!keepInputs) {
      widthField.sync();
      heightField.sync();
    }
    const valid = isValidSize();
    sizeError.hidden = valid;
    if (!valid) {
      sizeError.textContent = width * height > MAX_CANVAS_PIXELS
        ? `合計ピクセル数 (幅 × 高さ) は ${MAX_CANVAS_PIXELS.toLocaleString()} 以下にしてください (iPad / iPhone のブラウザの上限)。`
        : `幅と高さは ${SIZE_RANGE[0]}〜${SIZE_RANGE[1]} の範囲で指定してください。`;
    }
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    shapeBox.style.width = `min(100%, ${200 * aspect}px)`;
    shapeBox.style.aspectRatio = `${Math.max(width, 1)} / ${Math.max(height, 1)}`;
    shapeLabel.textContent = `${width} × ${height}`;
    pickButton.disabled = !valid || busy;
    footer.textContent = `最大 ${MAX_PHOTOS} 枚まで選べます。次の画面で 3 種類のレイアウトを見比べられます。`
      + (saved ? '新しく写真を選ぶと、前回の作業は消えます。' : '');

    resumeCard.hidden = !saved;
    resumeButton.disabled = busy;
    if (saved) {
      const date = new Date(saved.savedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
      resumeInfo.replaceChildren(
        h('div', { class: 'resume-title' }, `${saved.photos.length} 枚・${saved.canvasW} × ${saved.canvasH} px`),
        h('div', { class: 'caption' },
          `${saved.cells?.length ? layoutTitle(saved.layoutKind) : 'レイアウト未選択'} ・ ${date} に保存`));
    }
  }

  async function refreshSaved() {
    const project = await store.loadProject();
    saved = project?.photos?.length ? project : null;
    render();
  }

  async function loadPhotos(allFiles) {
    if (busy || !isValidSize()) return;
    const images = allFiles.filter(isImageFile);
    const files = images.slice(0, MAX_PHOTOS);
    const messages = [];
    if (images.length < allFiles.length) messages.push(`画像ではないファイル ${allFiles.length - images.length} 件を除外しました。`);
    if (images.length > MAX_PHOTOS) messages.push(`${MAX_PHOTOS} 枚を超えた ${images.length - MAX_PHOTOS} 枚は除外しました。`);
    if (!files.length) {
      await alertDialog('読み込みエラー', '画像ファイルが選ばれていません。');
      return;
    }

    busy = true;
    render();
    await store.clearAll();
    saved = null;
    const loading = showLoading('写真を読み込み中');
    loading.update(0, files.length);
    const { photos } = await loadPhotoFiles(files, previewMaxPixel(files.length),
      (done, total) => loading.update(done, total));
    const stored = photos.length ? await store.putPhotos(photos) : false;
    loading.close();
    busy = false;
    render();

    if (!photos.length) {
      await alertDialog('読み込みエラー', '写真を読み込めませんでした。');
      return;
    }
    if (photos.length < files.length) {
      messages.push(`${files.length - photos.length} 枚の写真を読み込めなかったため、除外しました。`);
    }
    if (!stored) messages.push('このブラウザでは作業内容を保存できないため、続きからの再開はできません。');
    if (messages.length) await alertDialog('お知らせ', messages.join('\n'));

    const project = new Project(width, height, photos);
    nav.push(createCompareScreen(nav, project));
  }

  async function resume() {
    if (!saved || busy) return;
    busy = true;
    render();
    const loading = showLoading('前回の作業を読み込み中');
    const project = await Project.restore(saved, (done, total) => loading.update(done, total));
    loading.close();
    busy = false;
    if (!project) {
      await store.clearAll();
      saved = null;
      render();
      await alertDialog('読み込みエラー', '前回の作業の写真を読み込めませんでした。');
      return;
    }
    render();
    // レイアウトを選ぶ前の状態で保存されていたら、見比べ画面から再開する
    nav.push(createCompareScreen(nav, project, { opensEditor: project.cells.length > 0 }));
  }

  render();
  return { el, onShow: refreshSaved };
}
