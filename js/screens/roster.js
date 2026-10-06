/**
 * 選手一覧画面。#/roster で表示する。所持選手(初期の所持選手 + ガチャで獲得した選手)とステータスを並べる。
 * スタメン(自チームのデッキに入っている選手)を先頭に、試合の立ち位置・背番号付きで出す。
 * データは VolleyballData から読むので、保存先が JSON でも DB でもこの画面は変わらない。
 */
(function () {
  'use strict';

  const escapeHtml = VolleyballUI.escapeHtml;

  function cardHtml(c, index) {
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

    return '<li class="roster-card' + (c.team ? ' is-starter' : '') + '" style="animation-delay:' + Math.min(index, 12) * 50 + 'ms">' +
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
      let disposed = false;

      VolleyballData.getOwnedCharacters().then(owned => {
        if (disposed) return;
        const starters = owned.filter(o => o.team).length;
        content.innerHTML =
          '<p class="roster-team">所持選手<span>' + owned.length + '人(スタメン ' + starters + '人)</span></p>' +
          '<ul class="roster-list">' + owned.slice().sort(VolleyballUI.compareOwned).map(cardHtml).join('') + '</ul>';
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
