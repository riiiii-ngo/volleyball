/**
 * VolleyballHeader
 * 画面上部の共通ヘッダー(ユーザ名・所持ダイヤ・所持コイン)。index.html の #appHeader に1つだけ作り、
 * VolleyballApp.start({ header: VolleyballHeader.create(el) }) で渡す。
 * 表示/非表示は画面ごとに VolleyballApp が切り替える(画面定義の hideHeader)。
 * 値は VolleyballData.getPlayer() から読む。
 */
(function (global) {
  'use strict';

  const ICONS = {
    user: '<circle cx="12" cy="8" r="4.2"/><path d="M3.5 21c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z"/>',
    diamond: '<path d="M6.5 3h11L22 9l-10 12L2 9z"/>',
    coin: '<circle cx="12" cy="12" r="9.5"/>'
  };

  function svg(name) {
    return '<svg class="app-header-icon is-' + name + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function formatAmount(n) {
    return Number(n).toLocaleString('ja-JP');
  }

  function create(el) {
    el.classList.add('app-header');
    el.hidden = true;
    el.innerHTML =
      '<div class="app-header-inner">' +
        '<p class="app-header-user">' + svg('user') + '<span class="app-header-name"></span></p>' +
        '<ul class="app-header-wallet">' +
          '<li class="app-header-currency is-diamond">' + svg('diamond') + '<span class="app-header-amount">-</span></li>' +
          '<li class="app-header-currency is-coin">' + svg('coin') + '<span class="app-header-amount">-</span></li>' +
        '</ul>' +
      '</div>';

    const nameEl = el.querySelector('.app-header-name');
    const diamondEl = el.querySelector('.is-diamond');
    const coinEl = el.querySelector('.is-coin');
    let requestId = 0;

    function render(p) {
      nameEl.textContent = p.name;
      diamondEl.querySelector('.app-header-amount').textContent = formatAmount(p.diamonds);
      diamondEl.title = 'ダイヤ ' + formatAmount(p.diamonds) + '(有償 ' + formatAmount(p.paidDiamonds) + ' / 無償 ' + formatAmount(p.freeDiamonds) + ')';
      diamondEl.setAttribute('aria-label', diamondEl.title);
      coinEl.title = 'コイン ' + formatAmount(p.coins);
      coinEl.setAttribute('aria-label', coinEl.title);
      coinEl.querySelector('.app-header-amount').textContent = formatAmount(p.coins);
    }

    return {
      show(visible) { el.hidden = !visible; },
      refresh() {
        const id = ++requestId; // 古い読み込みが後から返ってきても上書きしない
        return VolleyballData.getPlayer().then(p => {
          if (id === requestId) render(p);
        }, err => {
          if (id === requestId) nameEl.textContent = '読み込み失敗';
          throw err; // エラーバナーにも出す
        });
      }
    };
  }

  global.VolleyballHeader = Object.freeze({ create: create });
})(window);
