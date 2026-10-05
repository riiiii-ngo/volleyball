/**
 * VolleyballUI
 * 複数の画面で使う小さな表示部品(HTML文字列を返す)。
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // レベルと経験値バー。最大レベルなら MAX 表示。
  function levelHtml(c) {
    const ratio = c.expToNext > 0 ? Math.min(100, (c.exp / c.expToNext) * 100) : 100;
    const expText = c.expToNext > 0 ? c.exp + ' / ' + c.expToNext : 'MAX';
    return '<span class="ui-level">' +
      '<span class="ui-level-lv">Lv.<b>' + c.level + '</b></span>' +
      '<span class="ui-level-bar"><span style="width:' + ratio + '%"></span></span>' +
      '<span class="ui-level-exp">' + expText + '</span>' +
    '</span>';
  }

  // 育成ポイント(0なら目立たせない)
  function pointsHtml(points) {
    return '<span class="ui-points' + (points > 0 ? ' has-points' : '') + '">' + points + '<small>pt</small></span>';
  }

  global.VolleyballUI = Object.freeze({ escapeHtml: escapeHtml, levelHtml: levelHtml, pointsHtml: pointsHtml });
})(window);
