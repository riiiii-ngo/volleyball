/**
 * VolleyballJoystick モデル
 * オンスクリーン仮想ジョイスティック。最初は画面下部中央に表示し、画面のどこか(ボタン以外)を触ると
 * その場所を中心に台座が移動してそこから操作できる。指を離しても台座は最後に触った場所に残る。
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

    // 画面全体のタッチ受付(ボタンより下、3D描画より上)。触った場所に台座を移す
    const area = document.createElement('div');
    area.className = 'vb-joystick-area';

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
      const label = document.createElement('span');
      label.className = 'vb-joystick-zone-label';
      zone.appendChild(label);
      base.appendChild(zone);
      zoneEls[name] = zone;
    });
    // トス方向を選んでいる間だけ台座の上に出す見出し(パスの質など)
    const caption = document.createElement('div');
    caption.className = 'vb-joystick-caption';
    caption.hidden = true;

    const knob = document.createElement('div');
    knob.className = 'vb-joystick-knob';
    knob.style.width = opt.knobSize + 'px';
    knob.style.height = opt.knobSize + 'px';
    base.appendChild(knob);

    opt.parent.appendChild(area);
    opt.parent.appendChild(base);
    opt.parent.appendChild(caption);

    const radius = opt.size / 2;
    const maxOffset = radius - opt.knobSize / 2;
    const value = { x: 0, y: 0 };
    let dragging = false;
    let pointerId = null; // 操作中の指(2本目以降の指は無視する)
    const EDGE_MARGIN = 8; // 台座が画面からはみ出さないように空ける余白(px)

    // 台座を (x, y) を中心とする位置に動かす(画面からはみ出さないように寄せる)。見出しも台座の上に付いていく
    function moveBaseTo(x, y) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = Math.min(Math.max(x, radius + EDGE_MARGIN), w - radius - EDGE_MARGIN);
      const cy = Math.min(Math.max(y, radius + EDGE_MARGIN), h - radius - EDGE_MARGIN);
      base.style.left = cx + 'px';
      base.style.top = cy + 'px';
      base.style.bottom = 'auto';
      base.style.transform = 'translate(-50%, -50%)';
      caption.style.left = cx + 'px';
      caption.style.bottom = 'auto';
      // 見出しは台座の上。上に余裕が無ければ下に出す
      if (cy - radius - 36 >= EDGE_MARGIN) {
        caption.style.top = (cy - radius - 8) + 'px';
        caption.style.transform = 'translate(-50%, -100%)';
      } else {
        caption.style.top = (cy + radius + 8) + 'px';
        caption.style.transform = 'translate(-50%, 0)';
      }
    }

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
      pointerId = null;
      value.x = 0;
      value.y = 0;
      setKnobOffset(0, 0);
    }

    area.addEventListener('pointerdown', (e) => {
      if (dragging) return; // 操作中に別の指で触っても動かさない
      // 既定動作(テキスト選択)を止める。選択範囲が残ると次の押下でブラウザ標準の
      // ドラッグ&ドロップが始まり、pointercancel → reset() でスティックが効かなくなる。
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      area.setPointerCapture(e.pointerId);
      moveBaseTo(e.clientX, e.clientY);
      updateFromPointer(e.clientX, e.clientY);
    });
    area.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      updateFromPointer(e.clientX, e.clientY);
    });
    function onRelease(e) {
      if (e.pointerId === pointerId) reset();
    }
    // 画面の向きが変わったら、動かした台座が画面からはみ出さないように寄せ直す
    function onResize() {
      if (base.style.left) moveBaseTo(parseFloat(base.style.left), parseFloat(base.style.top));
    }
    window.addEventListener('resize', onResize);
    area.addEventListener('pointerup', onRelease);
    area.addEventListener('pointercancel', onRelease);

    reset();

    function setActiveZone(zone) {
      zoneNames.forEach(name => {
        zoneEls[name].classList.toggle('vb-joystick-zone-active', name === zone);
      });
    }

    // ゾーンごとの名前と選べるかどうか。zones: { left|center|right: { label, enabled } } / null で消す
    let lastZonesKey = '';
    function setZones(zones) {
      const key = zones ? zoneNames.map(n => zones[n].label + zones[n].enabled).join('|') : '';
      if (key === lastZonesKey) return;
      lastZonesKey = key;
      zoneNames.forEach(name => {
        const z = zones && zones[name];
        zoneEls[name].firstChild.textContent = z ? z.label : '';
        zoneEls[name].classList.toggle('vb-joystick-zone-disabled', !!z && !z.enabled);
      });
    }

    function setCaption(text) {
      caption.hidden = !text;
      if (caption.textContent !== (text || '')) caption.textContent = text || '';
    }

    function destroy() {
      reset();
      window.removeEventListener('resize', onResize);
      area.remove(); // ほかのリスナーは area 自身に付いているので要素ごと破棄される
      base.remove();
      caption.remove();
    }

    return {
      element: base,
      get value() { return { x: value.x, y: value.y }; },
      setActiveZone: setActiveZone,
      setZones: setZones,
      setCaption: setCaption,
      destroy: destroy
    };
  }

  global.VolleyballJoystick = Object.freeze({ create: create });
})(window);
