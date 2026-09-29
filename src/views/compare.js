import { formatPercent, h, icon } from '../util.js';
import { LAYOUT_KINDS } from '../layout/index.js';
import { newSeed } from '../layout/random.js';
import { drawCollage, prepareCanvas } from '../services/render.js';
import { button, confirmDialog, topBar } from './common.js';
import { createEditorScreen } from './editor.js';

/** 写真を選んだ直後に A・B・C のレイアウトを見比べて選ぶ画面 */
export function createCompareScreen(nav, project, { opensEditor = false } = {}) {
  /** kind → { seed, cells, computing, generation } */
  const candidates = new Map(LAYOUT_KINDS.map((k) => [k.id, { seed: 0, cells: null, computing: false, generation: 0 }]));
  let didAppear = false;
  /** 候補を計算したときの写真領域のサイズ (縁やタイトルを変えると変わる) */
  let candidatesContentKey = '';
  const contentKey = () => { const s = project.contentSize; return `${s.w}x${s.h}`; };

  // MARK: 主役の指定 (C)

  const featuredCaption = h('p', { class: 'caption' });
  const thumbs = project.photos.map((photo) => {
    const el = h('button', {
      type: 'button', class: 'thumb',
      onClick: () => {
        if (project.featuredIds.has(photo.id)) project.featuredIds.delete(photo.id);
        else project.featuredIds.add(photo.id);
        if (project.cells.length) project.save();
        renderFeatured();
        regenerate('featured', candidates.get('featured').seed);
      },
    }, h('img', { src: photo.previewURL, alt: photo.name, draggable: 'false' }), icon('star'));
    return { el, photo };
  });

  function renderFeatured() {
    const count = project.featuredIds.size;
    featuredCaption.textContent = count === 0
      ? '写真をタップして ★ を付けると、C でその写真を大きく配置します。付けなければ自動で選びます。'
      : `${count} 枚を主役にしています。もう一度タップすると外せます。`;
    for (const { el, photo } of thumbs) {
      const featured = project.featuredIds.has(photo.id);
      el.classList.toggle('featured', featured);
      el.setAttribute('aria-label', featured ? '主役から外す' : '主役にする');
      el.setAttribute('aria-pressed', String(featured));
    }
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
      cropLabel.textContent = candidate.cells ? `トリミング ${formatPercent(project.averageCropLoss(candidate.cells))}` : '';
      stage.classList.toggle('computing', candidate.computing);
      stage.classList.toggle('empty', !candidate.cells);
      editButton.disabled = !candidate.cells || candidate.computing;
      draw();
    };
    return { el, update, observer };
  }

  const el = h('div', { class: 'screen' },
    topBar('レイアウトを選ぶ', {
      leading: [button('設定', { iconName: 'back', variant: 'plain', onClick: () => nav.back() })],
    }),
    h('main', { class: 'screen-body' },
      h('div', { class: 'compare' },
        h('section', { class: 'featured-picker' },
          h('h2', { class: 'section-title' }, '主役の写真 (C で大きく配置)'),
          featuredCaption,
          h('div', { class: 'thumb-strip' }, thumbs.map((t) => t.el))),
        h('div', { class: 'layout-grid' }, [...cards.values()].map((c) => c.el)))));

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
    if (!candidate.cells || candidate.computing) return;
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
    renderFeatured();
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
    destroy() { for (const card of cards.values()) card.observer.disconnect(); },
  };
}
