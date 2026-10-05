/**
 * 選手一覧画面。#/roster で表示する。自チーム('player')のメンバーとステータスを並べる。
 * データは VolleyballData から読むので、保存先が JSON でも DB でもこの画面は変わらない。
 */
(function () {
  'use strict';

  // スロット → 表示用の役割名(試合の立ち位置)
  const SLOT_LABELS = {
    'front-1': '前衛レフト',
    'front-2': '前衛センター',
    'front-3': '前衛ライト',
    'back-1': '後衛',
    'back-2': '後衛',
    'back-3': '後衛',
    server: 'サーバー'
  };

  const escapeHtml = VolleyballUI.escapeHtml;

  function cardHtml(member, index) {
    const c = member.character;
    const stats = VolleyballData.STATS.map(s => {
      const v = c.stats[s.key];
      const bonus = c.bonus[s.key];
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
      SLOT_LABELS[member.slot] || member.slot,
      c.height ? c.height + 'cm' : ''
    ].filter(Boolean).join(' / ');

    return '<li class="roster-card" style="animation-delay:' + (index * 50) + 'ms">' +
      '<div class="roster-card-head">' +
        '<span class="roster-number">' + (c.number != null ? escapeHtml(c.number) : '-') + '</span>' +
        '<span class="roster-name-block">' +
          '<span class="roster-kana">' + escapeHtml(c.kana) + '</span>' +
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
      let disposed = false;

      VolleyballData.getTeam('player').then(team => {
        if (disposed) return;
        content.innerHTML =
          '<p class="roster-team">' + escapeHtml(team.name) + '<span>' + team.members.length + '人</span></p>' +
          '<ul class="roster-list">' + team.members.map(cardHtml).join('') + '</ul>';
      }).catch(err => {
        if (disposed) return;
        content.innerHTML = '<p class="roster-status is-error">' + escapeHtml(err.message) + '</p>';
      });

      return {
        unmount() { disposed = true; }
      };
    }
  });
})();
