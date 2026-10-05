/**
 * VolleyballJoystick モデル
 * 画面下部中央に表示するオンスクリーン仮想ジョイスティック。
 * DOM/CSS の生成と、指/マウスでのドラッグ入力の正規化のみを担当する。
 * ゲーム側は VolleyballJoystick.create() でインスタンスを取得し、
 * 毎フレーム instance.value で {x, y}（各 -1〜1）を読み取って
 * トス/スパイクの狙い位置などに使う想定。画面を離れる時は instance.destroy() で DOM ごと取り除く。
 */
(function (global) {
  'use strict';

  function create(options) {
    const opt = Object.assign({
      size: 132,
      knobSize: 56,
      deadzone: 0.08,
      parent: document.body // 台座を追加する親要素
    }, options || {});

    const base = document.createElement('div');
    base.className = 'vb-joystick-base';
    base.style.width = opt.size + 'px';
    base.style.height = opt.size + 'px';

    // トス方向指定用：レフト/センター/ライトの3等分ゾーン(円形なので overflow:hidden でクリップされる)。
    const zoneNames = ['left', 'center', 'right'];
    const zoneEls = {};
    zoneNames.forEach((name, i) => {
      const zone = document.createElement('div');
      zone.className = 'vb-joystick-zone vb-joystick-zone-' + name;
      zone.style.left = (i * (100 / 3)) + '%';
      base.appendChild(zone);
      zoneEls[name] = zone;
    });

    const knob = document.createElement('div');
    knob.className = 'vb-joystick-knob';
    knob.style.width = opt.knobSize + 'px';
    knob.style.height = opt.knobSize + 'px';
    base.appendChild(knob);

    opt.parent.appendChild(base);

    const radius = opt.size / 2;
    const maxOffset = radius - opt.knobSize / 2;
    const value = { x: 0, y: 0 };
    let dragging = false;

    function setKnobOffset(dx, dy) {
      knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    }

    function updateFromPointer(clientX, clientY) {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxOffset) {
        dx = (dx / dist) * maxOffset;
        dy = (dy / dist) * maxOffset;
      }
      setKnobOffset(dx, dy);

      let nx = dx / maxOffset;
      let ny = dy / maxOffset;
      if (Math.hypot(nx, ny) < opt.deadzone) { nx = 0; ny = 0; }
      value.x = nx;
      value.y = -ny; // 上方向をプラスにする
    }

    function reset() {
      dragging = false;
      value.x = 0;
      value.y = 0;
      setKnobOffset(0, 0);
    }

    base.addEventListener('pointerdown', (e) => {
      // 既定動作(テキスト選択)を止める。選択範囲が残ると次の押下でブラウザ標準の
      // ドラッグ&ドロップが始まり、pointercancel → reset() でスティックが効かなくなる。
      e.preventDefault();
      dragging = true;
      base.setPointerCapture(e.pointerId);
      updateFromPointer(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      updateFromPointer(e.clientX, e.clientY);
    });
    base.addEventListener('pointerup', reset);
    base.addEventListener('pointercancel', reset);

    reset();

    function setActiveZone(zone) {
      zoneNames.forEach(name => {
        zoneEls[name].classList.toggle('vb-joystick-zone-active', name === zone);
      });
    }

    function destroy() {
      reset();
      base.remove(); // リスナーは base 自身に付いているので要素ごと破棄される
    }

    return {
      element: base,
      get value() { return { x: value.x, y: value.y }; },
      setActiveZone: setActiveZone,
      destroy: destroy
    };
  }

  global.VolleyballJoystick = Object.freeze({ create: create });
})(window);
