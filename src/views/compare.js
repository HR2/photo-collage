import { formatPercent, h, icon } from '../util.js';
import { LAYOUT_KINDS } from '../layout/index.js';
import { newSeed } from '../layout/random.js';
import { isImageFile, loadPhotoFiles, MAX_PHOTOS, previewMaxPixel } from '../services/images.js';
import { drawCollage, prepareCanvas } from '../services/render.js';
import * as store from '../services/store.js';
import { alertDialog, button, confirmDialog, dismissToast, showLoading, showToast, topBar } from './common.js';
import { createEditorScreen } from './editor.js';

/** 写真を選んだ直後に A・B・C のレイアウトを見比べて選ぶ画面。写真の追加・削除と主役の指定もここで行う。 */
export function createCompareScreen(nav, project, { opensEditor = false } = {}) {
  /** kind → { seed, cells, computing, generation } */
  const candidates = new Map(LAYOUT_KINDS.map((k) => [k.id, { seed: 0, cells: null, computing: false, generation: 0 }]));
  let didAppear = false;
  /** 候補を計算したときの写真領域のサイズ (縁やタイトルを変えると変わる) */
  let candidatesContentKey = '';
  const contentKey = () => { const s = project.contentSize; return `${s.w}x${s.h}`; };
  let busy = false;

  // MARK: 写真の一覧 (追加・削除・主役の指定)

  const photosTitle = h('h2', { class: 'section-title' });
  const photosCaption = h('p', { class: 'caption' });
  const strip = h('div', { class: 'thumb-strip' });

  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) addFiles(files);
  });
  const addTile = h('button', {
    type: 'button', class: 'thumb add-tile', 'aria-label': '写真を追加',
    onClick: () => fileInput.click(),
  }, icon('plus'), h('span', {}, '追加'));

  function thumbnail(photo) {
    const featured = project.featuredIds.has(photo.id);
    const star = h('button', {
      type: 'button',
      class: `thumb${featured ? ' featured' : ''}`,
      'aria-label': featured ? '主役から外す' : '主役にする',
      'aria-pressed': String(featured),
      onClick: () => toggleFeatured(photo),
    }, h('img', { src: photo.previewURL, alt: photo.name, draggable: 'false' }), icon('star'));
    const remove = project.photos.length > 1 && h('button', {
      type: 'button', class: 'thumb-remove', 'aria-label': '写真を削除', title: '削除',
      onClick: () => removePhoto(photo),
    }, icon('close'));
    return h('div', { class: 'thumb-item' }, star, remove);
  }

  function renderPhotos() {
    const count = project.photos.length;
    photosTitle.textContent = `写真 (${count} 枚)`;
    const featuredCount = project.featuredIds.size;
    photosCaption.textContent = (featuredCount === 0
      ? 'タップして ★ を付けると、C でその写真を大きく配置します (付けなければ自動で選びます)。'
      : `${featuredCount} 枚を主役にしています。もう一度タップすると外せます。`)
      + ' × で削除、＋ で追加できます。';
    addTile.disabled = count >= MAX_PHOTOS || busy;
    strip.replaceChildren(...project.photos.map(thumbnail), addTile);
  }

  function toggleFeatured(photo) {
    if (project.featuredIds.has(photo.id)) project.featuredIds.delete(photo.id);
    else project.featuredIds.add(photo.id);
    project.save();
    renderPhotos();
    regenerate('featured', candidates.get('featured').seed);
  }

  /** 写真を変えるとレイアウトを作り直すので、編集済みなら確認する */
  async function confirmDiscardEdits() {
    if (!project.canUndo) return true;
    return confirmDialog({
      title: '編集内容を破棄しますか？',
      message: '写真を変えるとレイアウトを作り直すため、写真の入れ替えや拡大・縮小などの編集は元に戻せなくなります。',
      confirmLabel: '破棄して写真を変更',
      destructive: true,
    });
  }

  /** 写真が変わったら一覧を描き直し、3 方式とも計算し直す */
  function photosChanged() {
    renderPhotos();
    for (const [kind, candidate] of candidates) regenerate(kind, candidate.seed);
    project.save();
  }

  async function removePhoto(photo) {
    if (busy || project.photos.length <= 1) return;
    if (!(await confirmDiscardEdits())) return;
    const removed = project.removePhoto(photo.id);
    if (!removed) return;
    store.deletePhotos([photo.id]);
    photosChanged();
    showToast('写真を 1 枚削除しました', {
      actionLabel: '元に戻す',
      onAction: async () => {
        if (project.photos.length >= MAX_PHOTOS) return;
        project.restorePhoto(removed);
        await store.putPhotos([removed.photo]);
        photosChanged();
      },
    });
  }

  async function addFiles(allFiles) {
    if (busy) return;
    const images = allFiles.filter(isImageFile);
    const room = MAX_PHOTOS - project.photos.length;
    const files = images.slice(0, Math.max(room, 0));
    const messages = [];
    if (images.length < allFiles.length) messages.push(`画像ではないファイル ${allFiles.length - images.length} 件を除外しました。`);
    if (images.length > files.length) messages.push(`写真は最大 ${MAX_PHOTOS} 枚までのため、${images.length - files.length} 枚は追加しませんでした。`);
    if (!files.length) {
      await alertDialog('追加できません', messages.join('\n') || '画像ファイルが選ばれていません。');
      return;
    }
    if (!(await confirmDiscardEdits())) return;

    busy = true;
    renderPhotos();
    dismissToast();
    const loading = showLoading('写真を読み込み中');
    loading.update(0, files.length);
    const maxPixel = previewMaxPixel(project.photos.length + files.length);
    const { photos, failed } = await loadPhotoFiles(files, maxPixel, (done, total) => loading.update(done, total));
    const stored = photos.length ? await store.putPhotos(photos) : true;
    loading.close();
    busy = false;

    if (photos.length) {
      project.addPhotos(photos);
      photosChanged();
      // 追加した写真が見えるよう一覧の端までスクロールする
      strip.scrollTo({ left: strip.scrollWidth, behavior: 'smooth' });
    } else {
      renderPhotos();
    }
    if (failed) messages.push(`${failed} 枚の写真を読み込めなかったため、除外しました。`);
    if (!stored) messages.push('このブラウザでは写真を保存できないため、続きからの再開はできません。');
    if (messages.length) await alertDialog('お知らせ', messages.join('\n'));
  }

  // MARK: 各方式のカード

  const cards = new Map(LAYOUT_KINDS.map((kind) => [kind.id, makeCard(kind)]));

  function makeCard(kind) {
    const cropLabel = h('span', { class: 'crop-label' });
    const canvas = h('canvas', { 'aria-label': `${kind.title} のプレビュー` });
    const stage = h('div', { class: 'card-stage', onClick: () => choose(kind.id) },
      canvas, h('div', { class: 'spinner stage-spinner' }));
    stage.style.aspectRatio = `${project.canvasW} / ${project.canvasH}`;
    const editButton = button('この案で編集', { variant: 'primary', onClick: () => choose(kind.id) });
    const el = h('section', { class: 'card layout-card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, kind.title), cropLabel),
      h('p', { class: 'caption' }, kind.summary),
      stage,
      h('div', { class: 'card-actions' },
        button('別の案', { iconName: 'shuffle', onClick: () => regenerate(kind.id, newSeed()) }),
        editButton));

    const draw = () => {
      const width = stage.clientWidth;
      if (!width) return;
      const height = (width * project.canvasH) / project.canvasW;
      const { ctx, dpr } = prepareCanvas(canvas, width, height);
      const candidate = candidates.get(kind.id);
      if (candidate.cells) {
        drawCollage(ctx, project, { scale: width / project.canvasW, cells: candidate.cells, pixelRatio: dpr });
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(stage);

    const update = () => {
      const candidate = candidates.get(kind.id);
      cropLabel.textContent = candidate.cells && !candidate.computing
        ? `トリミング ${formatPercent(project.averageCropLoss(candidate.cells))}` : '';
      stage.classList.toggle('computing', candidate.computing);
      stage.classList.toggle('empty', !candidate.cells);
      editButton.disabled = !candidate.cells || candidate.computing;
      draw();
    };
    return { el, update, observer };
  }

  const body = h('div', { class: 'compare' },
    h('section', { class: 'photo-manager' }, photosTitle, photosCaption, strip, fileInput),
    h('div', { class: 'layout-grid' }, [...cards.values()].map((c) => c.el)));

  // 画面のどこに写真をドロップしても追加できる
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  body.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    body.classList.add('dragging');
  });
  body.addEventListener('dragleave', (event) => {
    if (!body.contains(event.relatedTarget)) body.classList.remove('dragging');
  });
  body.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    body.classList.remove('dragging');
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) addFiles(files);
  });

  const el = h('div', { class: 'screen' },
    topBar('レイアウトを選ぶ', {
      leading: [button('設定', { iconName: 'back', variant: 'plain', onClick: () => nav.back() })],
    }),
    h('main', { class: 'screen-body' }, body));

  function regenerate(kind, seed) {
    const candidate = candidates.get(kind);
    candidate.seed = seed;
    candidate.computing = true;
    candidate.generation += 1;
    const generation = candidate.generation;
    cards.get(kind).update();

    project.computeLayout(kind, seed).then((cells) => {
      // 古い計算結果で上書きしない
      if (candidate.generation !== generation) return;
      candidate.cells = cells;
      candidate.computing = false;
      cards.get(kind).update();
    }, (error) => {
      console.error(error);
      if (candidate.generation !== generation) return;
      candidate.computing = false;
      cards.get(kind).update();
    });
  }

  async function choose(kind) {
    const candidate = candidates.get(kind);
    if (!candidate.cells || candidate.computing || busy) return;
    if (project.canUndo) {
      const ok = await confirmDialog({
        title: '編集内容を破棄しますか？',
        message: '写真の入れ替えや拡大・縮小などの編集は元に戻せなくなります。',
        confirmLabel: '破棄して選び直す',
        destructive: true,
      });
      if (!ok) return;
    }
    project.apply(kind, candidate.seed, candidate.cells);
    nav.push(createEditorScreen(nav, project));
  }

  function onShow() {
    renderPhotos();
    project.save();
    if (!didAppear) {
      didAppear = true;
      candidatesContentKey = contentKey();
      if (opensEditor) {
        // 再開したプロジェクトの現在のレイアウトを、その方式の案として表示する
        Object.assign(candidates.get(project.layoutKind), { seed: project.layoutSeed, cells: project.cells });
      }
      for (const [kind, candidate] of candidates) {
        if (!candidate.cells) regenerate(kind, 0);
      }
      if (opensEditor) {
        nav.push(createEditorScreen(nav, project));
        return;
      }
    } else if (candidatesContentKey !== contentKey()) {
      // 編集画面で縁やタイトルを変えて戻ってきたら、今の形で計算し直す
      candidatesContentKey = contentKey();
      for (const [kind, candidate] of candidates) regenerate(kind, candidate.seed);
    }
    // 背景色やタイトルが変わっているかもしれないので描き直す
    for (const card of cards.values()) card.update();
  }

  return {
    el,
    onShow,
    // 「元に戻す」は見比べ画面でしか使えないので、画面を離れたら閉じる
    onHide: dismissToast,
    destroy() {
      dismissToast();
      for (const card of cards.values()) card.observer.disconnect();
    },
  };
}
