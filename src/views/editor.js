import { formatBytes, formatPercent, h, icon } from '../util.js';
import { TITLE_FONTS } from '../model/geometry.js';
import { layoutTitle } from '../layout/index.js';
import { EXPORT_FORMATS, exportCollage } from '../services/exporter.js';
import { alertDialog, button, openDialog, showLoading, topBar } from './common.js';
import { createEditorCanvas } from './editorCanvas.js';

/** コラージュの編集画面 */
export function createEditorScreen(nav, project) {
  const minSide = Math.min(project.canvasW, project.canvasH);
  const maxBorder = Math.max(Math.round(minSide / 10), 1);
  const maxSpacing = Math.max(Math.round(minSide / 20), 1);
  const minTitleSize = Math.max(Math.round(minSide * 0.02), 8);
  const maxTitleSize = Math.max(Math.round(minSide * 0.15), minTitleSize + 1);

  let relayouting = false;
  let exporting = false;

  const canvas = createEditorCanvas(project);

  // MARK: ツールバー

  const undoButton = button('', { iconName: 'undo', variant: 'plain', title: '取り消す (⌘Z)', onClick: () => project.undo() });
  const redoButton = button('', { iconName: 'redo', variant: 'plain', title: 'やり直す (⇧⌘Z)', onClick: () => project.redo() });
  const exportMenu = h('details', { class: 'menu' },
    h('summary', { class: 'btn primary' }, icon('share'), h('span', { class: 'btn-label' }, '書き出し')),
    h('div', { class: 'menu-items' },
      EXPORT_FORMATS.map((format) => h('button', {
        type: 'button',
        onClick: () => { exportMenu.open = false; runExport(format.id); },
      }, `${format.title} で書き出し`))));
  // メニューの外を押したら閉じる
  const closeMenu = (event) => { if (!exportMenu.contains(event.target)) exportMenu.open = false; };

  // MARK: 設定パネル

  const kindValue = h('span', {});
  const kindSpinner = h('span', { class: 'spinner small', hidden: true });
  const layoutButtons = [
    button('別の案', { iconName: 'shuffle', variant: 'row', onClick: () => runRelayout(() => project.shuffleLayout()) }),
    button('最初の案に戻す', { iconName: 'reset', variant: 'row', onClick: () => runRelayout(() => project.resetLayout()) }),
    button('ほかの方式と見比べる', { iconName: 'grid', variant: 'row', onClick: () => nav.back() }),
    // 写真の追加・削除は見比べ画面で行う
    button('写真を追加・削除', { iconName: 'photos', variant: 'row', onClick: () => nav.back() }),
  ];

  const slider = (label, key, min, max) => {
    const value = h('span', { class: 'field-value' });
    const input = h('input', { type: 'range', min, max, step: 1, 'aria-label': label });
    input.addEventListener('input', () => project.set(key, Number(input.value)));
    return {
      el: h('label', { class: 'field' }, h('div', { class: 'field-head' }, h('span', {}, label), value), input),
      sync() { input.value = project[key]; value.textContent = `${Math.round(project[key])} px`; },
    };
  };

  const colorField = (label, key) => {
    const input = h('input', { type: 'color' });
    input.addEventListener('input', () => project.set(key, input.value));
    return {
      el: h('label', { class: 'field row' }, h('span', {}, label), input),
      sync() { input.value = project[key]; },
    };
  };

  const spacingSlider = slider('間隔', 'spacing', 0, maxSpacing);
  const borderSlider = slider('縁', 'border', 0, maxBorder);
  const backgroundField = colorField('背景・縁の色', 'background');

  const titleInput = h('input', {
    type: 'text', class: 'text-input', placeholder: 'タイトル (空欄なら表示しません)', maxlength: 100, enterkeyhint: 'done',
  });
  titleInput.addEventListener('input', () => project.set('title', titleInput.value.replace(/[\r\n]+/g, ' ')));
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });
  const fontSelect = h('select', { class: 'select' },
    TITLE_FONTS.map((f) => h('option', { value: f.id }, f.title)));
  fontSelect.addEventListener('change', () => project.set('titleFont', fontSelect.value));
  const titleSizeSlider = slider('文字の大きさ', 'titleFontSize', minTitleSize, maxTitleSize);
  const titleColorField = colorField('文字の色', 'titleColor');
  const titleOptions = h('div', { class: 'field-group' },
    h('label', { class: 'field row' }, h('span', {}, '書体'), fontSelect),
    titleSizeSlider.el,
    titleColorField.el);

  const infoCount = h('span', {});
  const infoCrop = h('span', {});

  const panel = h('aside', { class: 'settings' },
    h('section', { class: 'settings-section' },
      h('h2', {}, 'レイアウト'),
      h('div', { class: 'field row' }, h('span', {}, '方式'), h('span', { class: 'field-value' }, kindSpinner, kindValue)),
      layoutButtons),
    h('section', { class: 'settings-section' },
      h('h2', {}, '間隔・縁・背景'),
      spacingSlider.el, borderSlider.el, backgroundField.el),
    h('section', { class: 'settings-section' },
      h('h2', {}, 'タイトル'),
      titleInput,
      titleOptions,
      h('p', { class: 'footnote' }, '縁やタイトルを変えると写真の領域の形が変わります。「別の案」で今の形に合わせて並べ直せます。')),
    h('section', { class: 'settings-section' },
      h('h2', {}, '情報'),
      h('div', { class: 'field row' }, h('span', {}, '出力サイズ'), h('span', { class: 'field-value' }, `${project.canvasW} × ${project.canvasH}`)),
      h('div', { class: 'field row' }, h('span', {}, '写真'), infoCount),
      h('div', { class: 'field row' }, h('span', {}, 'トリミング (平均)'), infoCrop)));

  const el = h('div', { class: 'screen editor-screen' },
    topBar('編集', {
      leading: [button('レイアウト選択', { iconName: 'back', variant: 'plain', onClick: () => nav.back() })],
      trailing: [undoButton, redoButton, exportMenu],
    }),
    h('main', { class: 'editor' },
      h('div', { class: 'editor-main' },
        canvas.el,
        h('p', { class: 'hint' }, 'ドラッグで位置調整・ピンチ (Ctrl+ホイール) で拡大縮小・ダブルタップで元に戻す・長押ししてドラッグで入れ替え')),
      panel));

  function sync() {
    undoButton.disabled = !project.canUndo;
    redoButton.disabled = !project.canRedo;
    exportMenu.classList.toggle('disabled', exporting);

    kindValue.textContent = layoutTitle(project.layoutKind);
    kindSpinner.hidden = !relayouting;
    for (const b of layoutButtons) b.disabled = relayouting;

    spacingSlider.sync();
    borderSlider.sync();
    backgroundField.sync();
    if (document.activeElement !== titleInput) titleInput.value = project.title;
    fontSelect.value = project.titleFont;
    titleOptions.hidden = !project.frameGeometry.hasTitle;
    titleSizeSlider.sync();
    titleColorField.sync();

    infoCount.textContent = `${project.cells.length} 枚`;
    infoCrop.textContent = formatPercent(project.averageCropLoss());
  }

  // 編集内容は自動で保存し、次回開いたときに続きから再開できるようにする
  const unsubscribe = project.subscribe(() => {
    canvas.requestRender();
    sync();
    project.save();
  });

  async function runRelayout(work) {
    relayouting = true;
    sync();
    try {
      await work();
    } finally {
      relayouting = false;
      sync();
    }
  }

  async function runExport(formatId) {
    if (exporting) return;
    exporting = true;
    sync();
    const loading = showLoading('書き出し中');
    try {
      const result = await exportCollage(project, formatId, (done, total) => loading.update(done, total));
      loading.close();
      showExportResult(result);
    } catch (error) {
      loading.close();
      await alertDialog('エラー', error.message || '画像の書き出しに失敗しました。');
    } finally {
      exporting = false;
      sync();
    }
  }

  function onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) project.redo(); else project.undo();
    } else if (key === 'y') {
      event.preventDefault();
      project.redo();
    }
  }

  return {
    el,
    onShow() {
      sync();
      canvas.requestRender();
      project.save();
      addEventListener('keydown', onKeyDown);
      addEventListener('pointerdown', closeMenu);
    },
    onHide() {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('pointerdown', closeMenu);
    },
    destroy() {
      removeEventListener('keydown', onKeyDown);
      removeEventListener('pointerdown', closeMenu);
      unsubscribe();
      canvas.destroy();
    },
  };
}

/** 書き出した画像の確認と保存・共有 */
function showExportResult(result) {
  const url = URL.createObjectURL(result.blob);
  const file = new File([result.blob], result.fileName, { type: result.blob.type });
  const canShare = !!navigator.canShare?.({ files: [file] });

  const shareStatus = h('p', { class: 'caption', hidden: true });
  const shareButton = canShare && button('共有・写真に保存', {
    iconName: 'share',
    onClick: async () => {
      try {
        await navigator.share({ files: [file] });
      } catch (error) {
        if (error?.name !== 'AbortError') {
          shareStatus.hidden = false;
          shareStatus.textContent = '共有できませんでした。「ダウンロード」をお使いください。';
        }
      }
    },
  });
  const download = h('a', { class: 'btn primary', href: url, download: result.fileName },
    icon('download'), h('span', { class: 'btn-label' }, 'ダウンロード'));

  const dialog = openDialog([
    h('h2', {}, '書き出し完了'),
    h('div', { class: 'export-preview' }, h('img', { src: url, alt: '書き出したコラージュ' })),
    h('p', { class: 'caption center' }, `${result.width} × ${result.height} px ・ ${formatBytes(result.blob.size)}`),
    h('div', { class: 'dialog-actions center' }, download, shareButton),
    shareStatus,
    h('div', { class: 'dialog-actions' }, button('閉じる', { onClick: () => dialog.close() })),
  ], { className: 'export-dialog' });
  dialog.addEventListener('close', () => URL.revokeObjectURL(url));
}
