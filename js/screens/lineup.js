/**
 * スタメン設定画面。#/lineup で表示する。自チームが試合で使うデッキの7枠(WS1/WS2/MB1/MB2/OP/SE/LI)に選手を置く。
 * 枠をタップすると所持選手の一覧を重ねて表示し、選んだ選手をその枠に置く(VolleyballData.setLineupMember)。
 * 同じデッキの別の枠にいる選手を選ぶと入れ替え。本来のポジションと違う枠にも置けるが、試合ではステータスが下がる。
 */
(function () {
  'use strict';

  const esc = VolleyballUI.escapeHtml;

  function percentDown(rate) {
    return Math.round((1 - rate) * 100) + '%';
  }

  // 枠の役割名(試合での立ち位置。試合に出ない枠は「控え」)
  function slotRole(slot) {
    return slot.gameSlot ? VolleyballUI.roleLabel({ team: { slot: slot.gameSlot } }) : '控え(試合に出ない)';
  }

  function slotHtml(slot, i, rate) {
    const c = slot.member;
    return '<li style="animation-delay:' + i * 40 + 'ms">' +
      '<button type="button" class="lineup-slot' + (slot.gameSlot ? '' : ' is-bench') + (slot.offPosition ? ' is-off' : '') + '" data-key="' + slot.key + '">' +
        '<span class="lineup-slot-head">' +
          '<span class="lineup-slot-label">' + esc(slot.label) + '</span>' +
          '<span class="lineup-slot-role">' + esc(slotRole(slot)) + '</span>' +
        '</span>' +
        (c
          ? '<span class="lineup-slot-number">' + esc(slot.number != null ? slot.number : '-') + '</span>' +
            '<span class="lineup-slot-main">' +
              '<span class="lineup-slot-name">' + VolleyballUI.starsHtml(c.rarity) + '<b>' + esc(c.name) + '</b></span>' +
              '<span class="lineup-slot-info">Lv.' + c.level +
                (slot.offPosition
                  ? '<span class="lineup-off">適正外 能力−' + percentDown(rate) + '</span>'
                  : '<span class="lineup-ok">適正</span>') +
              '</span>' +
            '</span>' +
            '<span class="roster-pos" title="' + esc(VolleyballData.POSITIONS[c.position]) + '">' + esc(c.position) + '</span>'
          : '<span class="lineup-slot-empty">空き(タップして選手を置く)</span>') +
      '</button>' +
    '</li>';
  }

  VolleyballApp.register('lineup', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen', 'lineup-screen');
      el.innerHTML =
        '<header class="menu-header">' +
          '<button type="button" class="roster-back">‹ チーム</button>' +
          '<h1 class="menu-heading">' +
            '<span class="menu-heading-en">LINEUP</span>' +
            '<span class="menu-heading-ja">スタメン設定</span>' +
          '</h1>' +
        '</header>' +
        '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
      el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['team']));
      const content = el.querySelector('.roster-content');

      let disposed = false;
      let busy = false;
      let lineup = null;
      let picker = null;

      function render() {
        const rate = lineup.offPositionRate;
        content.innerHTML =
          '<p class="training-hint">枠をタップして選手を選びます。本来のポジションと違う枠にも置けますが、試合ではステータスが' +
            percentDown(rate) + '下がります。7枠とも試合に出ます(リベロは後衛のMBと交代で入ります)。</p>' +
          '<ul class="lineup-list">' + lineup.slots.map((s, i) => slotHtml(s, i, rate)).join('') + '</ul>';
        content.querySelectorAll('.lineup-slot').forEach(btn => {
          btn.addEventListener('click', () => openPicker(lineup.slots.find(s => s.key === btn.dataset.key)));
        });
      }

      // ---------- 選手を選ぶ(重ねて表示) ----------
      function openPicker(slot) {
        closePicker();
        VolleyballData.getOwnedCharacters().then(owned => {
          if (disposed) return;
          const inSlot = {}; // 所持選手ID → 置かれている枠
          lineup.slots.forEach(s => { if (s.member) inSlot[s.member.playerCharacterId] = s; });
          // 並び順:ポジションが合う選手 → レベルの高い順 → レア度の高い順 → 獲得順
          const list = owned.slice().sort((a, b) =>
            ((b.position === slot.position) - (a.position === slot.position)) ||
            (b.level - a.level) || (b.rarity - a.rarity) || (a.playerCharacterId - b.playerCharacterId));
          const rate = lineup.offPositionRate;
          picker = document.createElement('div');
          picker.className = 'lineup-picker';
          picker.setAttribute('role', 'dialog');
          picker.setAttribute('aria-modal', 'true');
          picker.innerHTML =
            '<div class="lineup-picker-card">' +
              '<p class="lineup-picker-title"><b>' + esc(slot.label) + '</b>' + esc(slotRole(slot)) + 'に置く選手</p>' +
              '<ul class="lineup-picker-list">' + list.map(c => {
                const at = inSlot[c.playerCharacterId];
                const here = at && at.key === slot.key;
                const fits = c.position === slot.position;
                return '<li><button type="button" class="lineup-pick' + (here ? ' is-current' : '') + '" data-id="' + c.playerCharacterId + '"' + (here ? ' disabled' : '') + '>' +
                  '<span class="roster-pos">' + esc(c.position) + '</span>' +
                  '<span class="lineup-pick-main">' +
                    '<span class="lineup-slot-name">' + VolleyballUI.starsHtml(c.rarity) + '<b>' + esc(c.name) + '</b></span>' +
                    '<span class="lineup-slot-info">Lv.' + c.level +
                      (fits ? '<span class="lineup-ok">適正</span>' : '<span class="lineup-off">適正外 能力−' + percentDown(rate) + '</span>') +
                    '</span>' +
                  '</span>' +
                  '<span class="lineup-pick-tag">' + (here ? 'この枠' : at ? esc(at.label) + 'と入れ替え' : '') + '</span>' +
                '</button></li>';
              }).join('') + '</ul>' +
              '<div class="training-actions">' +
                (!slot.required && slot.member
                  ? '<button type="button" class="training-btn is-reset lineup-picker-clear">枠を空ける</button>'
                  : '<span></span>') +
                '<button type="button" class="training-btn is-reset lineup-picker-close">閉じる</button>' +
              '</div>' +
            '</div>';
          el.appendChild(picker);
          picker.addEventListener('click', e => { if (e.target === picker) closePicker(); });
          picker.querySelector('.lineup-picker-close').addEventListener('click', closePicker);
          const clear = picker.querySelector('.lineup-picker-clear');
          if (clear) clear.addEventListener('click', () => assign(slot, null));
          picker.querySelectorAll('.lineup-pick:not(:disabled)').forEach(btn => {
            btn.addEventListener('click', () => assign(slot, Number(btn.dataset.id)));
          });
          document.addEventListener('keydown', onKey);
          picker.querySelector('.lineup-picker-close').focus();
        }).catch(err => app.toast(err.message));
      }
      function closePicker() {
        if (!picker) return;
        picker.remove();
        picker = null;
        document.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Escape') closePicker();
      }

      function assign(slot, playerCharacterId) {
        if (busy) return;
        busy = true;
        VolleyballData.setLineupMember(slot.key, playerCharacterId).then(updated => {
          if (disposed) return;
          lineup = updated;
          closePicker();
          render();
          const now = updated.slots.find(s => s.key === slot.key);
          app.toast(now.member
            ? now.member.name + 'を' + now.label + 'に置きました' + (now.offPosition ? '(適正外)' : '')
            : slot.label + 'を空けました');
        }).catch(err => app.toast(err.message)).then(() => { busy = false; });
      }

      VolleyballData.getLineup().then(l => {
        if (disposed) return;
        lineup = l;
        render();
      }).catch(err => {
        if (disposed) return;
        content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
      });

      return {
        unmount() {
          disposed = true;
          closePicker();
        }
      };
    }
  });
})();
