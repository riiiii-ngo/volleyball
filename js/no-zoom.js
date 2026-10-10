/**
 * ゲーム全体でブラウザのズームを止める(スマホでのダブルタップ・ピンチ)。
 *   - CSS の touch-action: manipulation(css/base.css)と viewport の user-scalable=no に加え、
 *     それらを無視することがある iOS Safari 向けにここでも止める。
 *   - ダブルタップ:前のタップから DOUBLE_TAP_MS 以内のタップは既定動作(ズーム)を止める。
 *     既定動作を止めるとクリックも起きなくなるので、指を動かしていないタップなら自分でクリックを送る
 *     (サーブボタンなどの連打はそのまま効く。スクロールのスワイプはクリックにしない)。
 *   - ピンチ:iOS Safari の gesture イベントを止める。
 */
(function () {
  'use strict';

  const DOUBLE_TAP_MS = 350;
  const TAP_MOVE_PX = 10; // これより指が動いたらタップではない(スクロールなど)
  const starts = new Map(); // touch.identifier → { x, y, moved }
  let lastTapEnd = 0;

  document.addEventListener('touchstart', e => {
    Array.from(e.changedTouches).forEach(t => starts.set(t.identifier, { x: t.clientX, y: t.clientY, moved: false }));
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    Array.from(e.changedTouches).forEach(t => {
      const s = starts.get(t.identifier);
      if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP_MOVE_PX) s.moved = true;
    });
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const now = Date.now();
    const t = e.changedTouches[0];
    const s = t && starts.get(t.identifier);
    Array.from(e.changedTouches).forEach(x => starts.delete(x.identifier));
    const isTap = !!s && !s.moved;
    if (now - lastTapEnd <= DOUBLE_TAP_MS && e.cancelable) {
      e.preventDefault();
      const target = e.target;
      if (isTap && target instanceof HTMLElement && !target.closest(':disabled')) target.click();
    }
    if (isTap) lastTapEnd = now;
  }, { passive: false });

  document.addEventListener('touchcancel', e => {
    Array.from(e.changedTouches).forEach(t => starts.delete(t.identifier));
  }, { passive: true });

  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, e => e.preventDefault(), { passive: false });
  });
})();
