import { h, icon } from '../util.js';

/**
 * 画面の積み重ね。ブラウザの「戻る」でも前の画面に戻れるよう履歴と連動させる。
 * 画面は { el, onShow?, onHide?, destroy? }。
 */
export function createNavigator(root) {
  const stack = [];

  function mountTop() {
    const top = stack[stack.length - 1];
    root.replaceChildren(top.el);
    window.scrollTo(0, 0);
    top.onShow?.();
  }

  const nav = {
    push(screen) {
      stack[stack.length - 1]?.onHide?.();
      stack.push(screen);
      const state = { depth: stack.length };
      if (stack.length === 1) history.replaceState(state, '');
      else history.pushState(state, '');
      mountTop();
    },
    back() {
      if (stack.length > 1) history.back();
    },
    handlePopState(event) {
      const depth = Math.max(event.state?.depth ?? 1, 1);
      if (depth >= stack.length) return;
      stack[stack.length - 1].onHide?.();
      while (stack.length > depth) stack.pop().destroy?.();
      mountTop();
    },
  };
  addEventListener('popstate', (event) => nav.handlePopState(event));
  return nav;
}

/** 画面上部のバー */
export function topBar(title, { leading = [], trailing = [] } = {}) {
  return h('header', { class: 'bar' },
    h('div', { class: 'bar-side' }, leading),
    h('h1', { class: 'bar-title' }, title),
    h('div', { class: 'bar-side end' }, trailing));
}

export function button(label, { iconName, variant = '', onClick, title } = {}) {
  return h('button', { type: 'button', class: `btn ${variant}`.trim(), onClick, title, 'aria-label': title },
    iconName && icon(iconName), label && h('span', { class: 'btn-label' }, label));
}

/** 処理中の表示。update(done, total) で進み具合を出せる。 */
export function showLoading(title) {
  const spinner = h('div', { class: 'spinner' });
  const bar = h('progress', { max: 1, value: 0, hidden: true });
  const label = h('div', { class: 'loading-label' }, `${title}…`);
  const el = h('div', { class: 'loading-overlay', role: 'status' },
    h('div', { class: 'loading-box' }, spinner, bar, label));
  document.body.append(el);
  return {
    update(done, total) {
      spinner.hidden = true;
      bar.hidden = false;
      bar.max = total;
      bar.value = done;
      label.textContent = `${title}… ${done}/${total}`;
    },
    close() { el.remove(); },
  };
}

let currentToast = null;

/** 画面下部に短いお知らせを出す。actionLabel を指定するとボタン (「元に戻す」など) を付ける。 */
export function showToast(message, { actionLabel, onAction, duration = 6000 } = {}) {
  currentToast?.dismiss();
  const el = h('div', { class: 'toast', role: 'status' },
    h('span', {}, message),
    actionLabel && h('button', {
      type: 'button', class: 'toast-action',
      onClick: () => { toast.dismiss(); onAction?.(); },
    }, actionLabel));
  document.body.append(el);
  const timer = setTimeout(() => toast.dismiss(), duration);
  const toast = {
    dismiss() {
      clearTimeout(timer);
      el.remove();
      if (currentToast === toast) currentToast = null;
    },
  };
  currentToast = toast;
  return toast;
}

export function dismissToast() {
  currentToast?.dismiss();
}

function openDialog(content, { className = '' } = {}) {
  const dialog = h('dialog', { class: `dialog ${className}`.trim() }, content);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  return dialog;
}

export function alertDialog(title, message) {
  return new Promise((resolve) => {
    const ok = button('OK', { variant: 'primary', onClick: () => dialog.close() });
    const dialog = openDialog([
      h('h2', {}, title),
      message && h('p', {}, message),
      h('div', { class: 'dialog-actions' }, ok),
    ]);
    dialog.addEventListener('close', () => resolve());
  });
}

export function confirmDialog({ title, message, confirmLabel, destructive = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dialog = openDialog([
      h('h2', {}, title),
      message && h('p', {}, message),
      h('div', { class: 'dialog-actions' },
        button('キャンセル', { onClick: () => dialog.close() }),
        button(confirmLabel, {
          variant: destructive ? 'danger' : 'primary',
          onClick: () => { result = true; dialog.close(); },
        })),
    ]);
    dialog.addEventListener('close', () => resolve(result));
  });
}

export { openDialog };
