/**
 * 選手育成画面。
 *   #/training        自チームの選手一覧(レベル・育成ポイント)
 *   #/training/<id>   その選手の育成ポイントをステータスに割り振る
 * 割り振りは「＋/−」で仮決めし、「決定」で VolleyballData.allocatePoints() に保存する。
 * 保存済みの割り振りは戻せない(−は今回仮決めした分だけ)。
 * 割り振り画面では、所持している経験値チケットを使ってレベルを上げられる(VolleyballData.useExpTicket())。
 */
(function () {
  'use strict';

  const esc = VolleyballUI.escapeHtml;

  function headerHtml(backLabel, en, ja) {
    return '<header class="menu-header">' +
      '<button type="button" class="roster-back">' + backLabel + '</button>' +
      '<h1 class="menu-heading">' +
        '<span class="menu-heading-en">' + en + '</span>' +
        '<span class="menu-heading-ja">' + esc(ja) + '</span>' +
      '</h1>' +
    '</header>';
  }

  // ---------- 一覧 ----------
  function renderList(el, app, state) {
    el.innerHTML = headerHtml('‹ チーム', 'TRAINING', '選手育成') +
      '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
    el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['team']));
    const content = el.querySelector('.roster-content');

    VolleyballData.getTeam('player').then(team => {
      if (state.disposed) return;
      content.innerHTML =
        '<p class="training-hint">フリー練習のラリーや経験値チケットで経験値がたまり、レベルが上がると育成ポイントがもらえます。</p>' +
        '<ul class="training-list">' + team.members.map((m, i) => {
          const c = m.character;
          return '<li style="animation-delay:' + (i * 50) + 'ms"><button type="button" class="training-row" data-id="' + esc(c.id) + '">' +
            '<span class="roster-number">' + esc(c.number != null ? c.number : '-') + '</span>' +
            '<span class="training-row-main">' +
              '<span class="roster-name">' + esc(c.name) + '</span>' +
              VolleyballUI.levelHtml(c) +
            '</span>' +
            VolleyballUI.pointsHtml(c.points) +
          '</button></li>';
        }).join('') + '</ul>';
      content.querySelectorAll('.training-row').forEach(btn => {
        btn.addEventListener('click', () => app.go('training', [btn.dataset.id]));
      });
    }).catch(err => {
      if (state.disposed) return;
      content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
    });
  }

  // ---------- 割り振り ----------
  function renderDetail(el, app, state, id) {
    el.innerHTML = headerHtml('‹ 選手育成', 'TRAINING', '') +
      '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
    el.querySelector('.roster-back').addEventListener('click', () => app.go('training'));
    const content = el.querySelector('.roster-content');
    const headingJa = el.querySelector('.menu-heading-ja');

    let character = null;
    let tickets = []; // 所持している経験値チケット
    let pending = {}; // 今回仮決めしている上げ幅 { stat: n }
    let busy = false;

    function pendingTotal() {
      return Object.keys(pending).reduce((sum, k) => sum + pending[k], 0);
    }

    function draw() {
      const c = character;
      const left = c.points - pendingTotal();
      headingJa.textContent = c.name;
      content.innerHTML =
        '<div class="training-panel">' +
          '<div class="training-summary">' +
            '<span class="roster-pos">' + esc(c.position) + '</span>' +
            VolleyballUI.levelHtml(c) +
          '</div>' +
          ticketsHtml(c) +
          '<p class="training-left">育成ポイント <b class="' + (left > 0 ? 'has-points' : '') + '">' + left + '</b> / ' + c.points + '</p>' +
          '<ul class="training-stats">' + VolleyballData.STATS.map(s => {
            const add = pending[s.key] || 0;
            const v = c.stats[s.key];
            const canUp = left > 0 && v + add < VolleyballData.STAT_MAX;
            return '<li class="training-stat">' +
              '<span class="roster-stat-label">' + s.label + '</span>' +
              '<span class="training-stat-bar">' +
                '<span class="is-base" style="width:' + (v - c.bonus[s.key]) + '%"></span>' +
                '<span class="is-bonus" style="width:' + c.bonus[s.key] + '%"></span>' +
                '<span class="is-pending" style="width:' + add + '%"></span>' +
              '</span>' +
              '<span class="training-stat-value' + (add ? ' is-changed' : '') + '">' + (v + add) + '</span>' +
              '<button type="button" class="training-step" data-stat="' + s.key + '" data-step="-1"' + (add > 0 ? '' : ' disabled') + ' aria-label="' + s.label + 'を下げる">−</button>' +
              '<button type="button" class="training-step" data-stat="' + s.key + '" data-step="1"' + (canUp ? '' : ' disabled') + ' aria-label="' + s.label + 'を上げる">＋</button>' +
            '</li>';
          }).join('') + '</ul>' +
          (c.points === 0
            ? '<p class="training-hint">育成ポイントがありません。フリー練習でレベルを上げましょう。</p>'
            : '') +
          '<div class="training-actions">' +
            '<button type="button" class="training-btn is-reset"' + (pendingTotal() ? '' : ' disabled') + '>リセット</button>' +
            '<button type="button" class="training-btn is-apply"' + (pendingTotal() ? '' : ' disabled') + '>決定</button>' +
          '</div>' +
        '</div>';

      content.querySelectorAll('.training-step').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.stat;
          pending[k] = Math.max(0, (pending[k] || 0) + Number(btn.dataset.step));
          if (!pending[k]) delete pending[k];
          draw();
        });
      });
      content.querySelectorAll('.training-ticket .shop-buy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (busy) return;
          busy = true;
          VolleyballData.useExpTicket(c.id, btn.dataset.item).then(r => {
            if (state.disposed) return;
            character = r.character;
            return VolleyballData.getItems('exp_ticket').then(list => {
              if (state.disposed) return;
              tickets = list;
              draw();
              app.toast(r.levelsGained > 0
                ? 'LEVEL UP! ' + r.character.name + ' Lv.' + r.character.level + '(育成ポイント+' + r.pointsGained + ')'
                : r.character.name + 'が経験値を' + r.exp + '獲得しました');
            });
          }).catch(err => app.toast(err.message)).then(() => { busy = false; });
        });
      });
      content.querySelector('.is-reset').addEventListener('click', () => { pending = {}; draw(); });
      content.querySelector('.is-apply').addEventListener('click', () => {
        VolleyballData.allocatePoints(c.id, pending).then(updated => {
          if (state.disposed) return;
          character = updated;
          pending = {};
          draw();
          app.toast(updated.name + 'のステータスを上げました');
        }).catch(err => app.toast(err.message));
      });
    }

    // 経験値チケット(持っていなければショップへの案内)
    function ticketsHtml(c) {
      const isMax = c.expToNext === 0;
      return '<p class="training-section-title">経験値チケット<a href="#/shop">ショップへ ›</a></p>' +
        (tickets.length === 0
          ? '<p class="training-hint">経験値チケットを持っていません。ショップのアイテムで手に入ります。</p>'
          : '<ul class="training-tickets">' + tickets.map(t =>
            '<li class="training-ticket">' +
              '<span class="training-ticket-main">' +
                '<span class="training-ticket-name">' + esc(t.name) + '</span>' +
                '<span class="training-ticket-info">経験値+' + t.effectValue + ' / 所持 <b>' + t.count + '</b></span>' +
              '</span>' +
              '<button type="button" class="shop-buy-btn" data-item="' + esc(t.id) + '"' + (isMax ? ' disabled' : '') + '>使う</button>' +
            '</li>').join('') + '</ul>');
    }

    Promise.all([VolleyballData.getCharacter(id), VolleyballData.getItems('exp_ticket')]).then(([c, list]) => {
      if (state.disposed) return;
      if (!c) { app.go('training', [], { replace: true }); return; }
      character = c;
      tickets = list;
      draw();
    }).catch(err => {
      if (state.disposed) return;
      content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
    });
  }

  VolleyballApp.register('training', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen', 'training-screen');
      let state = { disposed: false };

      function render(a) {
        state.disposed = true; // 前の表示の読み込み結果を無視させる
        state = { disposed: false };
        if (a[0]) renderDetail(el, app, state, a[0]);
        else renderList(el, app, state);
      }
      render(args);

      return {
        update(newArgs) { render(newArgs); },
        unmount() { state.disposed = true; }
      };
    }
  });
})();
