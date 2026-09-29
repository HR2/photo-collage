import { h } from '../util.js';
import { containsPoint, fittedSize } from '../model/geometry.js';
import { drawCellImage, drawCollage, prepareCanvas } from '../services/render.js';

const LONG_PRESS_MS = 350;
const PAN_THRESHOLD = 4;
const DOUBLE_TAP_MS = 350;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 編集画面のキャンバス。セルごとに次の操作ができる。
 * - ドラッグ → 表示位置の調整
 * - ピンチ (トラックパッドのピンチ / Ctrl+ホイール) → 拡大・縮小
 * - ダブルタップ → 元に戻す
 * - 長押ししてドラッグ → 別のセルの上で離すと写真を入れ替え
 */
export function createEditorCanvas(project) {
  const canvas = h('canvas', { class: 'editor-canvas', 'aria-label': 'コラージュ' });
  const liftCanvas = h('canvas', { class: 'lift-preview', hidden: true });
  const el = h('div', { class: 'editor-stage' }, canvas, liftCanvas);

  let scale = 1;
  let origin = { x: 0, y: 0 }; // stage 内でのキャンバスの位置
  /** セル ID → 表示座標の矩形 */
  let frames = new Map();

  /** ジェスチャー中のセルの拡大率と位置 (確定前) */
  let live = null; // { cellId, zoom, offset }
  /** 入れ替えのために持ち上げているセルと指の位置 */
  let lifted = null; // { cellId, point }
  let dropTargetId = null;

  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let wheel = null;

  // MARK: 描画

  let frameRequest = 0;
  function requestRender() {
    if (!frameRequest) frameRequest = requestAnimationFrame(() => { frameRequest = 0; render(); });
  }

  function render() {
    const box = { w: el.clientWidth, h: el.clientHeight };
    const size = fittedSize({ w: project.canvasW, h: project.canvasH }, box);
    if (!size.w || !size.h) return;
    scale = size.w / project.canvasW;
    origin = { x: (box.w - size.w) / 2, y: (box.h - size.h) / 2 };
    canvas.style.left = `${origin.x}px`;
    canvas.style.top = `${origin.y}px`;

    const geometry = project.frameGeometry;
    frames = new Map(project.cells.map((cell) => [cell.id, geometry.cellFrame(cell, project.spacing, scale)]));

    const { ctx, dpr } = prepareCanvas(canvas, size.w, size.h);
    drawCollage(ctx, project, {
      scale,
      pixelRatio: dpr,
      cropFor: (cell) => (live?.cellId === cell.id ? live : cell),
      dimmedId: lifted?.cellId,
      dropTargetId,
      accent: getComputedStyle(el).getPropertyValue('--accent').trim() || '#0a84ff',
    });
  }

  const observer = new ResizeObserver(requestRender);
  observer.observe(el);

  // MARK: 位置の計算

  const localPoint = (event) => {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  function cellAt(point) {
    for (const [id, frame] of frames) if (containsPoint(frame, point)) return id;
    return null;
  }

  const findCell = (id) => project.cells.find((c) => c.id === id);

  function currentCrop(cellId) {
    if (live?.cellId === cellId) return { zoom: live.zoom, offset: { ...live.offset } };
    const cell = findCell(cellId);
    return { zoom: cell.zoom, offset: { ...cell.offset } };
  }

  function setLive(cellId, zoom, offset) {
    live = { cellId, ...project.clampCrop(cellId, zoom, offset) };
    requestRender();
  }

  function commitLive() {
    if (!live) return;
    const { cellId, zoom, offset } = live;
    live = null;
    project.setCrop(cellId, zoom, offset);
    requestRender();
  }

  // MARK: ポインター操作

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    commitWheel();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* キャプチャできなくても操作は続ける */ }
    const point = localPoint(event);
    pointers.set(event.pointerId, point);

    if (pointers.size === 1) {
      const cellId = cellAt(point);
      if (!cellId) { gesture = null; return; }
      gesture = {
        type: 'pending',
        cellId,
        pointerId: event.pointerId,
        start: point,
        startTime: performance.now(),
        base: currentCrop(cellId),
        timer: setTimeout(startLift, LONG_PRESS_MS),
      };
    } else if (pointers.size === 2 && gesture && (gesture.type === 'pending' || gesture.type === 'pan')) {
      // 2 本目の指: 最初の指が触れたセルでピンチする
      clearTimeout(gesture.timer);
      const [a, b] = [...pointers.values()];
      gesture = {
        type: 'pinch',
        cellId: gesture.cellId,
        startDistance: Math.max(distance(a, b), 1),
        startMid: midpoint(a, b),
        base: currentCrop(gesture.cellId),
      };
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (!gesture) return;

    if (gesture.type === 'pending' && event.pointerId === gesture.pointerId
        && distance(point, gesture.start) > PAN_THRESHOLD) {
      clearTimeout(gesture.timer);
      gesture.type = 'pan';
    }

    switch (gesture.type) {
      case 'pan': {
        if (event.pointerId !== gesture.pointerId) return;
        const frame = frames.get(gesture.cellId);
        if (!frame) return;
        const { base } = gesture;
        setLive(gesture.cellId, base.zoom, {
          x: base.offset.x + (point.x - gesture.start.x) / frame.w,
          y: base.offset.y + (point.y - gesture.start.y) / frame.h,
        });
        break;
      }
      case 'pinch': {
        const points = [...pointers.values()];
        if (points.length < 2) return;
        const frame = frames.get(gesture.cellId);
        if (!frame) return;
        const mid = midpoint(points[0], points[1]);
        const { base } = gesture;
        setLive(gesture.cellId, base.zoom * (distance(points[0], points[1]) / gesture.startDistance), {
          x: base.offset.x + (mid.x - gesture.startMid.x) / frame.w,
          y: base.offset.y + (mid.y - gesture.startMid.y) / frame.h,
        });
        break;
      }
      case 'lift': {
        lifted.point = point;
        const target = cellAt(point);
        dropTargetId = target && target !== gesture.cellId ? target : null;
        positionLiftPreview();
        requestRender();
        break;
      }
      default:
        break;
    }
  });

  function endPointer(event, cancelled) {
    if (!pointers.delete(event.pointerId) || !gesture) return;
    switch (gesture.type) {
      case 'pending':
        clearTimeout(gesture.timer);
        if (!cancelled && performance.now() - gesture.startTime < LONG_PRESS_MS) handleTap(gesture.cellId);
        gesture = null;
        break;
      case 'pan':
        if (event.pointerId !== gesture.pointerId) return;
        if (cancelled) live = null; else commitLive();
        gesture = null;
        requestRender();
        break;
      case 'pinch':
        if (cancelled) live = null; else commitLive();
        // 残りの指が離れるまでは何もしない
        gesture = pointers.size ? { type: 'ignore' } : null;
        requestRender();
        break;
      case 'lift': {
        const source = gesture.cellId;
        const target = cancelled ? null : dropTargetId;
        endLift();
        gesture = pointers.size ? { type: 'ignore' } : null;
        if (target) project.swapPhotos(source, target);
        requestRender();
        break;
      }
      default:
        if (!pointers.size) gesture = null;
    }
  }
  canvas.addEventListener('pointerup', (event) => endPointer(event, false));
  canvas.addEventListener('pointercancel', (event) => endPointer(event, true));

  function handleTap(cellId) {
    const now = performance.now();
    if (lastTap && lastTap.cellId === cellId && now - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = null;
      project.resetCrop(cellId);
    } else {
      lastTap = { cellId, time: now };
    }
  }

  // MARK: 入れ替え (長押ししてドラッグ)

  function startLift() {
    if (!gesture || gesture.type !== 'pending') return;
    const frame = frames.get(gesture.cellId);
    if (!frame) return;
    gesture.type = 'lift';
    lifted = { cellId: gesture.cellId, point: { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 } };
    dropTargetId = null;
    navigator.vibrate?.(10);
    drawLiftPreview(frame);
    positionLiftPreview();
    requestRender();
  }

  /** 元のセルの形のまま、長辺 160px 以下に縮小して指に追従させる */
  function drawLiftPreview(frame) {
    const cell = findCell(lifted.cellId);
    const photo = cell && project.photo(cell.photoId);
    if (!photo) return;
    const s = Math.min(1, 160 / Math.max(frame.w, frame.h));
    const w = frame.w * s, hgt = frame.h * s;
    const { ctx } = prepareCanvas(liftCanvas, w, hgt);
    drawCellImage(ctx, photo.preview, photo.aspect, { x: 0, y: 0, w, h: hgt }, cell.zoom, cell.offset);
    liftCanvas.hidden = false;
  }

  function positionLiftPreview() {
    if (!lifted) return;
    const w = liftCanvas.offsetWidth, hgt = liftCanvas.offsetHeight;
    liftCanvas.style.transform =
      `translate(${origin.x + lifted.point.x - w / 2}px, ${origin.y + lifted.point.y - hgt / 2}px)`;
  }

  function endLift() {
    lifted = null;
    dropTargetId = null;
    liftCanvas.hidden = true;
  }

  // MARK: ホイール・トラックパッド

  function commitWheel() {
    if (!wheel) return;
    clearTimeout(wheel.timer);
    wheel = null;
    commitLive();
  }

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (gesture) return;
    const cellId = cellAt(localPoint(event));
    if (!cellId) return;
    if (wheel?.cellId !== cellId) {
      commitWheel();
      wheel = { cellId, ...currentCrop(cellId) };
    }
    const frame = frames.get(cellId);
    const unit = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      // トラックパッドのピンチは ctrlKey 付きのホイールとして届く
      wheel.zoom *= Math.exp(-event.deltaY * unit * 0.01);
    } else {
      wheel.offset.x -= (event.deltaX * unit) / frame.w;
      wheel.offset.y -= (event.deltaY * unit) / frame.h;
    }
    setLive(cellId, wheel.zoom, wheel.offset);
    wheel.zoom = live.zoom;
    wheel.offset = { ...live.offset };
    // 連続した操作は 1 回の編集として取り消せるよう、止まってから確定する
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(commitWheel, 300);
  }, { passive: false });

  // iPad の Safari でページ全体が拡大されないようにする
  for (const type of ['gesturestart', 'gesturechange']) {
    el.addEventListener(type, (event) => event.preventDefault());
  }

  return {
    el,
    requestRender,
    destroy() {
      observer.disconnect();
      commitWheel();
      if (gesture?.timer) clearTimeout(gesture.timer);
    },
  };
}
