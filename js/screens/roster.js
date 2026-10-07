/**
 * 選手一覧画面。#/roster で表示する。所持選手(初期の所持選手 + ガチャで獲得した選手)とステータスを並べる。
 * スタメン(自チームのデッキに入っている選手)を先頭に、試合の立ち位置・背番号付きで出す。
 * 「売却」で売却モードにすると、カードをタップして複数の選手を選び、まとめて売却できる
 * (レア度に応じた経験値チケットがもらえる。デッキに入っている選手は選べない)。
 * データは VolleyballData から読むので、保存先が JSON でも DB でもこの画面は変わらない。
 */
(function () {
  'use strict';

  const escapeHtml = VolleyballUI.escapeHtml;

  function cardHtml(c, index, sell) {
    const stats = VolleyballData.ALL_STATS.map(s => {
      const v = c.allStats[s.key];
      const bonus = c.bonus[s.key] || 0;
      return '<li class="roster-stat' + (v >= 75 ? ' is-high' : '') + '">' +
        '<span class="roster-stat-label">' + s.label + '</span>' +
        '<span class="roster-stat-bar"><span style="width:' + v + '%"></span></span>' +
        '<span class="roster-stat-value">' + v +
          // 育成で上げた分
          (bonus > 0 ? '<span class="roster-stat-bonus">+' + bonus + '</span>' : '') +
        '</span>' +
      '</li>';
    }).join('');
    const profile = [
      VolleyballUI.roleLabel(c),
      c.height ? c.height + 'cm' : ''
    ].filter(Boolean).join(' / ');
    const number = c.number != null ? c.number : '-';

    const locked = sell && c.inDeck;
    const selected = sell && sell.selected.has(c.playerCharacterId);
    return '<li class="roster-card' + (c.team ? ' is-starter' : '') + (locked ? ' is-locked' : '') + (selected ? ' is-selected' : '') + '"' +
        ' data-id="' + c.playerCharacterId + '" style="animation-delay:' + Math.min(index, 12) * 50 + 'ms"' +
        (sell && !locked ? ' role="checkbox" tabindex="0" aria-checked="' + selected + '"' : '') + '>' +
      (sell ? '<div class="roster-sell-row">' +
        (locked
          ? '<span class="roster-sell-lock">デッキ使用中のため売却不可</span>'
          : '<span class="roster-sell-check" aria-hidden="true"></span>' +
            (c.sellReward ? '<span class="roster-sell-reward">' + escapeHtml(c.sellReward.itemName) + ' ×' + c.sellReward.count + '</span>' : '')) +
      '</div>' : '') +
      '<div class="roster-card-head">' +
        '<span class="roster-number">' + escapeHtml(number) + '</span>' +
        '<span class="roster-name-block">' +
          '<span class="roster-kana">' + VolleyballUI.starsHtml(c.rarity) + ' ' + escapeHtml(c.kana) + '</span>' +
          '<span class="roster-name">' + escapeHtml(c.name) + '</span>' +
          '<span class="roster-profile">' + escapeHtml(profile) + '</span>' +
        '</span>' +
        '<span class="roster-pos" title="' + escapeHtml(VolleyballData.POSITIONS[c.position]) + '">' + escapeHtml(c.position) + '</span>' +
      '</div>' +
      '<div class="roster-progress">' + VolleyballUI.levelHtml(c) + VolleyballUI.pointsHtml(c.points) + '</div>' +
      '<ul class="roster-stats">' + stats + '</ul>' +
    '</li>';
  }

  VolleyballApp.register('roster', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen');
      el.innerHTML =
        '<header class="menu-header">' +
          '<button type="button" class="roster-back">‹ チーム</button>' +
          '<h1 class="menu-heading">' +
            '<span class="menu-heading-en">ROSTER</span>' +
            '<span class="menu-heading-ja">選手一覧</span>' +
          '</h1>' +
        '</header>' +
        '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';

      el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['team']));
      const content = el.querySelector('.roster-content');
      // 売却モードの下部バー
      const bar = document.createElement('div');
      bar.className = 'roster-sellbar';
      bar.hidden = true;
      el.appendChild(bar);

      let disposed = false;
      let owned = [];
      let sell = null; // 売却モード中は { selected: Set<所持選手ID> }
      let busy = false;
      let confirmEl = null;

      function selectedUnits() {
        return sell ? owned.filter(c => sell.selected.has(c.playerCharacterId)) : [];
      }

      // 選んだ選手の売却でもらえるアイテム [{ name, count }]
      function rewardTotals(units) {
        const map = new Map();
        units.forEach(c => {
          if (c.sellReward) map.set(c.sellReward.itemName, (map.get(c.sellReward.itemName) || 0) + c.sellReward.count);
        });
        return Array.from(map, ([name, count]) => ({ name: name, count: count }));
      }
      function rewardText(units) {
        return rewardTotals(units).map(r => r.name + ' ×' + r.count).join('、') || 'なし';
      }

      function render() {
        const starters = owned.filter(o => o.team).length;
        content.innerHTML =
          '<div class="roster-team">' +
            '<p>所持選手<span>' + owned.length + '人(スタメン ' + starters + '人)</span></p>' +
            '<button type="button" class="roster-sell-toggle' + (sell ? ' is-active' : '') + '">' + (sell ? '売却をやめる' : '売却') + '</button>' +
          '</div>' +
          (sell ? '<p class="training-hint">売却する選手をタップして選んでください(複数選択可)。デッキに入っている選手は売却できません。</p>' : '') +
          '<ul class="roster-list' + (sell ? ' is-selling' : '') + '">' +
            owned.slice().sort(VolleyballUI.compareOwned).map((c, i) => cardHtml(c, i, sell)).join('') +
          '</ul>';
        content.querySelector('.roster-sell-toggle').addEventListener('click', () => {
          sell = sell ? null : { selected: new Set() };
          render();
        });
        if (sell) {
          content.querySelectorAll('.roster-card[role="checkbox"]').forEach(card => {
            const toggle = () => {
              const id = Number(card.dataset.id);
              if (sell.selected.has(id)) sell.selected.delete(id);
              else sell.selected.add(id);
              const on = sell.selected.has(id);
              card.classList.toggle('is-selected', on);
              card.setAttribute('aria-checked', String(on));
              renderBar();
            };
            card.addEventListener('click', toggle);
            card.addEventListener('keydown', e => {
              if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
            });
          });
        }
        renderBar();
      }

      function renderBar() {
        bar.hidden = !sell;
        if (!sell) { bar.innerHTML = ''; return; }
        const units = selectedUnits();
        bar.innerHTML =
          '<div class="roster-sellbar-inner">' +
            '<div class="roster-sellbar-info">' +
              '<span class="roster-sellbar-count"><b>' + units.length + '</b>人選択</span>' +
              '<span class="roster-sellbar-reward">獲得: ' + escapeHtml(rewardText(units)) + '</span>' +
            '</div>' +
            '<button type="button" class="training-btn is-reset roster-sellbar-clear"' + (units.length ? '' : ' disabled') + '>解除</button>' +
            '<button type="button" class="training-btn is-apply roster-sellbar-sell"' + (units.length ? '' : ' disabled') + '>売却する</button>' +
          '</div>';
        bar.querySelector('.roster-sellbar-clear').addEventListener('click', () => {
          sell.selected.clear();
          render();
        });
        bar.querySelector('.roster-sellbar-sell').addEventListener('click', openConfirm);
      }

      // 確認ダイアログ
      function openConfirm() {
        const units = selectedUnits();
        if (!units.length || confirmEl) return;
        confirmEl = document.createElement('div');
        confirmEl.className = 'roster-confirm';
        confirmEl.setAttribute('role', 'dialog');
        confirmEl.setAttribute('aria-modal', 'true');
        confirmEl.innerHTML =
          '<div class="roster-confirm-card">' +
            '<p class="roster-confirm-title">' + units.length + '人を売却しますか?</p>' +
            '<ul class="roster-confirm-list">' + units.slice().sort(VolleyballUI.compareOwned).map(c =>
              '<li>' + VolleyballUI.starsHtml(c.rarity) + '<span>' + escapeHtml(c.name) + '</span><small>Lv.' + c.level + '</small></li>').join('') +
            '</ul>' +
            '<p class="roster-confirm-reward">獲得: <b>' + escapeHtml(rewardText(units)) + '</b></p>' +
            '<p class="roster-confirm-note">売却した選手は元に戻せません(レベル・育成も消えます)。</p>' +
            '<div class="training-actions">' +
              '<button type="button" class="training-btn is-reset roster-confirm-cancel">やめる</button>' +
              '<button type="button" class="training-btn is-apply roster-confirm-ok">売却する</button>' +
            '</div>' +
          '</div>';
        el.appendChild(confirmEl);
        confirmEl.addEventListener('click', e => { if (e.target === confirmEl) closeConfirm(); });
        confirmEl.querySelector('.roster-confirm-cancel').addEventListener('click', closeConfirm);
        confirmEl.querySelector('.roster-confirm-ok').addEventListener('click', () => doSell(units));
        document.addEventListener('keydown', onKey);
        confirmEl.querySelector('.roster-confirm-ok').focus();
      }
      function closeConfirm() {
        if (!confirmEl) return;
        confirmEl.remove();
        confirmEl = null;
        document.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Escape') closeConfirm();
      }

      function doSell(units) {
        if (busy) return;
        busy = true;
        VolleyballData.sellCharacters(units.map(c => c.playerCharacterId)).then(result => {
          if (disposed) return;
          closeConfirm();
          app.toast(result.soldCount + '人を売却し、' +
            (result.rewards.map(r => r.item.name + 'を' + r.count + '枚').join('、') || '何も') + '獲得しました');
          sell.selected.clear();
          return load();
        }).catch(err => {
          closeConfirm();
          app.toast(err.message);
        }).then(() => { busy = false; });
      }

      function load() {
        return VolleyballData.getOwnedCharacters().then(list => {
          if (disposed) return;
          owned = list;
          render();
        });
      }

      load().catch(err => {
        if (disposed) return;
        content.innerHTML = '<p class="roster-status is-error">' + escapeHtml(err.message) + '</p>';
      });

      return {
        unmount() {
          disposed = true;
          closeConfirm();
        }
      };
    }
  });
})();
