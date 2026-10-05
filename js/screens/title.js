/**
 * タイトル画面。どこかをタップ(PCは任意のキー)でメニューへ。
 */
(function () {
  'use strict';

  VolleyballApp.register('title', {
    mount(el, args, app) {
      el.classList.add('title-screen');
      el.tabIndex = -1;
      el.innerHTML =
        '<div class="title-court"></div>' +
        '<h1 class="title-logo">' +
          '<span class="title-logo-main">VOLLEYBALL</span>' +
          '<span class="title-logo-sub">バレーボール</span>' +
        '</h1>' +
        '<p class="title-start">TAP TO START</p>' +
        '<span class="title-version">PROTOTYPE</span>';

      const start = () => app.go('menu');
      function onKey(e) {
        if (e.repeat) return;
        e.preventDefault();
        start();
      }
      el.addEventListener('click', start);
      document.addEventListener('keydown', onKey);
      el.focus();

      return {
        unmount() { document.removeEventListener('keydown', onKey); }
      };
    }
  });
})();
