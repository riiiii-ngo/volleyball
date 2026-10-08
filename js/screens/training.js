/**
 * 選手育成画面。
 *   #/training                所持選手の一覧(レベル・育成ポイント。スタメンが先頭)
 *   #/training/<所持選手ID>    その選手の育成ポイントをステータスに割り振る
 * レベル・育成は所持選手1体(player_character_id)ごと。
 * 割り振りは「＋/−」で仮決めし、「決定」で VolleyballData.allocatePoints() に保存する。
 * 1上げるのに使うポイントは、そのステータスを育成で上げた回数に応じて段階的に増える(VolleyballProgression.statUpCost)。
 * 保存済みの割り振りは戻せない(−は今回仮決めした分だけ)。
 * 割り振り画面では、所持している経験値チケットを使ってレベルを上げられる(1枚ずつ: VolleyballData.useExpTicket()、
 * 一括レベルアップ: 目標レベルを選ぶと使うチケットを VolleyballData.planLevelUp() で計算し、levelUpWithTickets() で使う)。
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

    VolleyballData.getOwnedCharacters().then(owned => {
      if (state.disposed) return;
      content.innerHTML =
        '<p class="training-hint">経験値チケットで経験値がたまり(試合では経験値は入りません)、レベルが上がると育成ポイントがもらえます。</p>' +
        '<ul class="training-list">' + owned.slice().sort(VolleyballUI.compareOwned).map((c, i) => {
          return '<li style="animation-delay:' + (Math.min(i, 12) * 50) + 'ms"><button type="button" class="training-row' + (c.team ? ' is-starter' : '') + '" data-id="' + c.playerCharacterId + '">' +
            '<span class="roster-number">' + esc(c.number != null ? c.number : '-') + '</span>' +
            '<span class="training-row-main">' +
              '<span class="training-row-name">' + VolleyballUI.starsHtml(c.rarity) + '<span class="roster-name">' + esc(c.name) + '</span>' +
                '<span class="training-row-role">' + esc(VolleyballUI.roleLabel(c)) + '</span></span>' +
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
    let bulkTarget = null; // 一括レベルアップの目標レベル(null なら今のレベル+1)
    let plan = null; // 一括レベルアップの計画(VolleyballData.planLevelUp の結果)
    let pending = {}; // 今回仮決めしている上げ幅 { stat: n }
    let busy = false;

    function pendingTotal() {
      return Object.keys(pending).reduce((sum, k) => sum + pending[k], 0);
    }

    // 仮決めしている分に使うポイント
    function pendingCost() {
      return Object.keys(pending).reduce((sum, k) =>
        sum + VolleyballProgression.statUpTotalCost(character.bonus[k] || 0, pending[k]), 0);
    }

    function draw() {
      const c = character;
      const left = c.points - pendingCost();
      headingJa.textContent = c.name;
      content.innerHTML =
        '<div class="training-panel">' +
          '<div class="training-summary">' +
            '<span class="roster-pos">' + esc(c.position) + '</span>' +
            VolleyballUI.levelHtml(c) +
          '</div>' +
          ticketsHtml(c) +
          bulkHtml(c) +
          '<p class="training-left">育成ポイント <b class="' + (left > 0 ? 'has-points' : '') + '">' + left + '</b> / ' + c.points + '</p>' +
          '<p class="training-hint">1上げるのに使うポイントは、育成で上げた回数に応じて増えます(' +
            VolleyballProgression.COST_STEP + '回ごとに+1pt)。</p>' +
          '<ul class="training-stats">' + VolleyballData.STATS.map(s => {
            const add = pending[s.key] || 0;
            const v = c.stats[s.key];
            const isMax = v + add >= VolleyballData.STAT_MAX;
            const cost = VolleyballProgression.statUpCost(c.bonus[s.key] + add); // 次の+1に使うポイント
            const canUp = !isMax && left >= cost;
            return '<li class="training-stat">' +
              '<span class="roster-stat-label">' + s.label + '</span>' +
              '<span class="training-stat-bar">' +
                '<span class="is-base" style="width:' + (v - c.bonus[s.key]) + '%"></span>' +
                '<span class="is-bonus" style="width:' + c.bonus[s.key] + '%"></span>' +
                '<span class="is-pending" style="width:' + add + '%"></span>' +
              '</span>' +
              '<span class="training-stat-value' + (add ? ' is-changed' : '') + '">' + (v + add) + '</span>' +
              '<span class="training-stat-cost' + (cost > 1 ? ' is-up' : '') + '" title="次に1上げるのに使うポイント">' +
                (isMax ? 'MAX' : cost + '<small>pt</small>') + '</span>' +
              '<button type="button" class="training-step" data-stat="' + s.key + '" data-step="-1"' + (add > 0 ? '' : ' disabled') + ' aria-label="' + s.label + 'を下げる">−</button>' +
              '<button type="button" class="training-step" data-stat="' + s.key + '" data-step="1"' + (canUp ? '' : ' disabled') + ' aria-label="' + s.label + 'を上げる">＋</button>' +
            '</li>';
          }).join('') + '</ul>' +
          (c.points === 0
            ? '<p class="training-hint">育成ポイントがありません。経験値チケットでレベルを上げましょう(レベルが1上がるごとに' +
              VolleyballProgression.POINTS_PER_LEVEL + 'pt)。</p>'
            : '') +
          '<div class="training-actions">' +
            '<button type="button" class="training-btn is-reset"' + (pendingTotal() ? '' : ' disabled') + '>リセット</button>' +
            '<button type="button" class="training-btn is-apply"' + (pendingTotal() ? '' : ' disabled') + '>決定</button>' +
          '</div>' +
        '</div>';

      content.querySelectorAll('.training-step[data-stat]').forEach(btn => {
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
          VolleyballData.useExpTicket(c.playerCharacterId, btn.dataset.item).then(r => {
            if (state.disposed) return;
            character = r.character;
            app.toast(r.levelsGained > 0
              ? 'LEVEL UP! ' + r.character.name + ' Lv.' + r.character.level + '(育成ポイント+' + r.pointsGained + ')'
              : r.character.name + 'が経験値を' + r.exp + '獲得しました');
            return reloadTickets();
          }).catch(err => app.toast(err.message)).then(() => { busy = false; });
        });
      });
      content.querySelectorAll('.training-bulk-step').forEach(btn => {
        btn.addEventListener('click', () => {
          const to = btn.dataset.to === 'max' ? plan.reachableLevel : plan.targetLevel + Number(btn.dataset.to);
          bulkTarget = Math.max(c.level + 1, Math.min(plan.reachableLevel, to));
          refreshPlan();
        });
      });
      const bulkBtn = content.querySelector('.training-bulk-apply');
      if (bulkBtn) bulkBtn.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        VolleyballData.levelUpWithTickets(c.playerCharacterId, plan.targetLevel).then(r => {
          if (state.disposed) return;
          character = r.character;
          bulkTarget = null;
          app.toast(r.levelsGained > 0
            ? 'LEVEL UP! ' + r.character.name + ' Lv.' + r.character.level + '(育成ポイント+' + r.pointsGained + ')'
            : r.character.name + 'が経験値を' + r.exp + '獲得しました');
          return reloadTickets();
        }).catch(err => app.toast(err.message)).then(() => { busy = false; });
      });
      content.querySelector('.training-actions .is-reset').addEventListener('click', () => { pending = {}; draw(); });
      content.querySelector('.training-actions .is-apply').addEventListener('click', () => {
        VolleyballData.allocatePoints(c.playerCharacterId, pending).then(updated => {
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

    // 一括レベルアップ:目標レベル・使うチケット・上がった後のレベル
    function bulkHtml(c) {
      if (!tickets.length) return '';
      const title = '<p class="training-section-title">一括レベルアップ</p>';
      if (c.expToNext === 0) return title + '<p class="training-hint">最大レベルです。</p>';
      if (!plan || plan.reachableLevel <= c.level) {
        return title + '<p class="training-hint">次のレベルまでの経験値チケットが足りません。</p>';
      }
      const t = plan.targetLevel;
      return title +
        '<div class="training-bulk">' +
          '<div class="training-bulk-target">' +
            '<span class="training-bulk-label">目標</span>' +
            '<button type="button" class="training-step training-bulk-step" data-to="-1"' + (t > c.level + 1 ? '' : ' disabled') + ' aria-label="目標レベルを下げる">−</button>' +
            '<span class="training-bulk-level">Lv.<b>' + t + '</b></span>' +
            '<button type="button" class="training-step training-bulk-step" data-to="1" data-step="1"' + (t < plan.reachableLevel ? '' : ' disabled') + ' aria-label="目標レベルを上げる">＋</button>' +
            '<button type="button" class="training-bulk-max training-bulk-step" data-to="max"' + (t < plan.reachableLevel ? '' : ' disabled') + '>MAX<small>Lv.' + plan.reachableLevel + '</small></button>' +
          '</div>' +
          '<ul class="training-bulk-uses">' + plan.uses.map(u =>
            '<li><span>' + esc(u.item.name) + '</span><b>×' + u.count + '</b><small>/ ' + u.item.count + '</small></li>').join('') +
          '</ul>' +
          '<p class="training-bulk-exp">経験値 +' + plan.totalExp + '(必要 ' + plan.needExp + ')</p>' +
          '<p class="training-bulk-result">Lv.' + c.level + ' → <b>Lv.' + plan.resultLevel + '</b>' +
            '<small>育成ポイント+' + plan.pointsGained + '</small></p>' +
          '<button type="button" class="training-btn is-apply training-bulk-apply">一括レベルアップ</button>' +
        '</div>';
    }

    function refreshPlan() {
      const c = character;
      const target = bulkTarget != null ? bulkTarget : c.level + 1;
      return VolleyballData.planLevelUp(c.playerCharacterId, target).then(p => {
        if (state.disposed) return;
        plan = p;
        draw();
      });
    }

    function reloadTickets() {
      return VolleyballData.getItems('exp_ticket').then(list => {
        if (state.disposed) return;
        tickets = list;
        return refreshPlan();
      });
    }

    Promise.all([VolleyballData.getOwnedCharacter(id), VolleyballData.getItems('exp_ticket')]).then(([c, list]) => {
      if (state.disposed) return;
      if (!c) { app.go('training', [], { replace: true }); return; }
      character = c;
      tickets = list;
      return refreshPlan();
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
