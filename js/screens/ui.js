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

  // レア度の星(★の数と色。スタイルは css/gacha.css の .gacha-stars)
  function starsHtml(rarity) {
    return '<span class="gacha-stars is-r' + rarity + '" aria-label="レア度' + rarity + '">' + '★'.repeat(rarity) + '</span>';
  }

  // 試合の立ち位置(slot = デッキの枠) → 表示用の役割名(サーブ順: SE→WS1→MB1→OP→WS2→MB2、リベロ)
  const SLOT_LABELS = Object.freeze({
    se: 'セッター',
    ws1: 'ウイングスパイカー(対角1)',
    mb1: 'ミドルブロッカー(対角1)',
    op: 'オポジット',
    ws2: 'ウイングスパイカー(対角2)',
    mb2: 'ミドルブロッカー(対角2)',
    li: 'リベロ'
  });
  const SLOT_ORDER = Object.keys(SLOT_LABELS);

  // 所持選手の並び順:スタメン(試合の立ち位置順) → 控え(レア度の高い順 → 獲得順)
  function compareOwned(a, b) {
    if (!!a.team !== !!b.team) return a.team ? -1 : 1;
    if (a.team) return SLOT_ORDER.indexOf(a.team.slot) - SLOT_ORDER.indexOf(b.team.slot);
    return (b.rarity - a.rarity) || (a.playerCharacterId - b.playerCharacterId);
  }

  // 役割名(スタメンなら立ち位置、それ以外は「控え」)
  function roleLabel(c) {
    return c.team ? SLOT_LABELS[c.team.slot] || c.team.slot : '控え';
  }

  global.VolleyballUI = Object.freeze({
    escapeHtml: escapeHtml,
    levelHtml: levelHtml,
    pointsHtml: pointsHtml,
    starsHtml: starsHtml,
    compareOwned: compareOwned,
    roleLabel: roleLabel
  });
})(window);
