/**
 * ガチャ画面。
 *   #/gacha        開催中(ガチャマスタの有効期間内)のガチャ一覧
 *   #/gacha/<id>   そのガチャを引く画面(1回 / 10回)。引くと同じ画面のまま結果を表示し、
 *                  「次へ」(見出し「ガチャ結果」の横。結果一覧とは別でスクロールしない)で引く画面に戻る。結果の選手をタップすると詳細を重ねて表示する。
 * 獲得した選手は VolleyballData.drawGacha() が所持選手(player_characters)に登録する。
 */
(function () {
  'use strict';

  const esc = VolleyballUI.escapeHtml;

  function headerHtml(backLabel, en, ja) {
    return '<header class="menu-header">' +
      '<button type="button" class="roster-back">' + backLabel + '</button>' +
      '<div class="gacha-heading-row">' +
        '<h1 class="menu-heading">' +
          '<span class="menu-heading-en">' + en + '</span>' +
          '<span class="menu-heading-ja">' + esc(ja) + '</span>' +
        '</h1>' +
        // 見出しの横に置くボタン(ガチャ結果の「次へ」)
        '<span class="gacha-heading-action"></span>' +
      '</div>' +
    '</header>';
  }

  const starsHtml = VolleyballUI.starsHtml;

  function pad(n) { return String(n).padStart(2, '0'); }
  function formatDate(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function periodText(g) {
    return formatDate(g.startAt) + ' 〜 ' + (g.endAt ? formatDate(g.endAt) : '常設');
  }

  // 0.818 → "0.818%"(小数点以下4桁まで、末尾の0は省く)
  function percent(p) {
    return Number(p.toFixed(4)) + '%';
  }

  function priceText(g, count) {
    if (g.isFree) return '無料';
    return (count === 1 ? g.singlePrice : g.multiPrice).toLocaleString() + ' ' + g.currencyLabel;
  }

  // ---------- 一覧 ----------
  function renderList(el, app, state) {
    el.innerHTML = headerHtml('‹ ショップ', 'GACHA', 'ガチャ') +
      '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
    el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['shop']));
    const content = el.querySelector('.roster-content');

    VolleyballData.getActiveGachas().then(gachas => {
      if (state.disposed) return;
      if (!gachas.length) {
        content.innerHTML = '<p class="gacha-empty">開催中のガチャはありません。</p>';
        return;
      }
      content.innerHTML = '<ul class="gacha-list">' + gachas.map((g, i) => {
        const top = g.rarityRates[0];
        return '<li style="animation-delay:' + (i * 50) + 'ms">' +
          '<button type="button" class="gacha-banner' + (g.isFree ? ' is-free' : '') + '" data-id="' + esc(g.id) + '">' +
            '<span class="gacha-banner-en" aria-hidden="true">GACHA</span>' +
            '<span class="gacha-banner-name">' + esc(g.name) + '</span>' +
            '<span class="gacha-banner-period">' + esc(periodText(g)) + '</span>' +
            '<span class="gacha-banner-foot">' +
              '<span class="gacha-banner-price">' + esc(g.isFree ? '無料' : '1回 ' + priceText(g, 1)) + '</span>' +
              (top ? '<span class="gacha-banner-top">' + starsHtml(top.rarity) + ' ' + percent(top.probability) + '</span>' : '') +
            '</span>' +
          '</button>' +
        '</li>';
      }).join('') + '</ul>';
      content.querySelectorAll('.gacha-banner').forEach(btn => {
        btn.addEventListener('click', () => app.go('gacha', [btn.dataset.id]));
      });
    }).catch(err => {
      if (state.disposed) return;
      content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
    });
  }

  // ---------- 引く画面 ----------
  function renderDraw(el, app, state, id) {
    el.innerHTML = headerHtml('‹ ガチャ一覧', 'GACHA', '') +
      '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
    el.querySelector('.roster-back').addEventListener('click', () => app.go('gacha'));
    const content = el.querySelector('.roster-content');
    const headingEn = el.querySelector('.menu-heading-en');
    const headingJa = el.querySelector('.menu-heading-ja');
    let gacha = null;
    let busy = false;
    const headingAction = el.querySelector('.gacha-heading-action');

    function drawPanel() {
      headingAction.innerHTML = '';
      const g = gacha;
      headingEn.textContent = 'GACHA';
      headingJa.textContent = g.name;
      const canDraw = g.isActive && g.isFree;
      const note = !g.isActive ? 'このガチャは開催期間外です。'
        : !g.isFree ? '有料のガチャは準備中です。今は無料のガチャだけ引けます。'
        : '';
      content.innerHTML =
        '<div class="gacha-panel">' +
          '<p class="gacha-period">開催期間 ' + esc(periodText(g)) + '</p>' +
          '<ul class="gacha-rates">' + g.rarityRates.map(r =>
            '<li>' + starsHtml(r.rarity) + '<span class="gacha-rate-value">' + percent(r.probability) + '</span>' +
            '<span class="gacha-rate-count">' + r.count + '人</span></li>'
          ).join('') + '</ul>' +
          '<details class="gacha-lineup">' +
            '<summary>排出される選手(' + g.lineup.length + '人)</summary>' +
            '<ul>' + g.lineup.map(l =>
              '<li>' + starsHtml(l.character.rarity) +
              '<span class="gacha-lineup-pos">' + esc(l.character.position) + '</span>' +
              '<span class="gacha-lineup-name">' + esc(l.character.name) + '</span>' +
              '<span class="gacha-lineup-p">' + percent(l.probability) + '</span></li>'
            ).join('') + '</ul>' +
          '</details>' +
          (note ? '<p class="gacha-note">' + esc(note) + '</p>' : '') +
          '<div class="gacha-actions">' + VolleyballData.GACHA_COUNTS.map(n =>
            '<button type="button" class="gacha-draw-btn' + (n > 1 ? ' is-multi' : '') + '" data-count="' + n + '"' + (canDraw ? '' : ' disabled') + '>' +
              '<span class="gacha-draw-label">' + (n === 1 ? '1回引く' : n + '回引く') + '</span>' +
              '<span class="gacha-draw-price">' + esc(priceText(g, n)) + '</span>' +
            '</button>'
          ).join('') + '</div>' +
        '</div>';
      content.scrollTop = 0;

      content.querySelectorAll('.gacha-draw-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (busy) return;
          busy = true;
          content.querySelectorAll('.gacha-draw-btn').forEach(b => { b.disabled = true; });
          VolleyballData.drawGacha(g.id, Number(btn.dataset.count)).then(results => {
            busy = false;
            if (state.disposed) return;
            drawResults(results);
          }).catch(err => {
            busy = false;
            if (state.disposed) return;
            app.toast(err.message);
            drawPanel();
          });
        });
      });
    }

    function drawResults(results) {
      headingEn.textContent = 'RESULT';
      headingJa.textContent = 'ガチャ結果';
      content.innerHTML =
        '<ul class="gacha-results' + (results.length === 1 ? ' is-single' : '') + '">' + results.map((r, i) => {
          const c = r.character;
          return '<li style="animation-delay:' + (i * 90) + 'ms">' +
            '<button type="button" class="gacha-card is-r' + c.rarity + '" data-index="' + i + '">' +
              (r.isNew ? '<span class="gacha-card-new">NEW</span>' : '') +
              starsHtml(c.rarity) +
              '<span class="gacha-card-pos">' + esc(c.position) + '</span>' +
              '<span class="gacha-card-kana">' + esc(c.kana) + '</span>' +
              '<span class="gacha-card-name">' + esc(c.name) + '</span>' +
            '</button>' +
          '</li>';
        }).join('') + '</ul>' +
        '<p class="gacha-hint">選手をタップすると詳細を見られます。獲得した選手は所持選手に追加されました。</p>';
      content.scrollTop = 0;
      // 「次へ」は結果一覧(スクロールする部分)ではなく、見出し「ガチャ結果」の横に置いて常に画面に出す
      headingAction.innerHTML = '<button type="button" class="gacha-next">次へ</button>';
      content.querySelectorAll('.gacha-card').forEach(btn => {
        btn.addEventListener('click', () => openDetail(el, results[Number(btn.dataset.index)].character));
      });
      headingAction.querySelector('.gacha-next').addEventListener('click', drawPanel);
    }

    VolleyballData.getGacha(id).then(g => {
      if (state.disposed) return;
      if (!g) {
        app.toast('ガチャが見つかりません');
        app.go('gacha', [], { replace: true });
        return;
      }
      gacha = g;
      drawPanel();
    }).catch(err => {
      if (state.disposed) return;
      content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
    });
  }

  // ---------- 選手の詳細(重ねて表示) ----------
  function openDetail(el, c) {
    const overlay = document.createElement('div');
    overlay.className = 'gacha-detail';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', c.name + 'の詳細');
    const profile = [VolleyballData.POSITIONS[c.position], c.height ? c.height + 'cm' : ''].filter(Boolean).join(' / ');
    overlay.innerHTML =
      '<div class="gacha-detail-card is-r' + c.rarity + '">' +
        '<div class="gacha-detail-head">' +
          '<span class="roster-name-block">' +
            starsHtml(c.rarity) +
            '<span class="roster-kana">' + esc(c.kana) + '</span>' +
            '<span class="roster-name">' + esc(c.name) + '</span>' +
            '<span class="roster-profile">' + esc(c.romaji) + '</span>' +
            '<span class="roster-profile">' + esc(profile) + '</span>' +
          '</span>' +
          '<span class="roster-pos" title="' + esc(VolleyballData.POSITIONS[c.position]) + '">' + esc(c.position) + '</span>' +
        '</div>' +
        '<p class="gacha-detail-lv">Lv.<b>' + c.level + '</b></p>' +
        '<ul class="roster-stats">' + VolleyballData.ALL_STATS.map(s => {
          const v = c.stats[s.key];
          return '<li class="roster-stat' + (v >= 75 ? ' is-high' : '') + '">' +
            '<span class="roster-stat-label">' + s.label + '</span>' +
            '<span class="roster-stat-bar"><span style="width:' + Math.min(100, v) + '%"></span></span>' +
            '<span class="roster-stat-value">' + v + '</span>' +
          '</li>';
        }).join('') + '</ul>' +
        '<button type="button" class="gacha-detail-close">閉じる</button>' +
      '</div>';

    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.gacha-detail-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    el.appendChild(overlay);
    overlay.querySelector('.gacha-detail-close').focus();
  }

  VolleyballApp.register('gacha', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen', 'gacha-screen');
      let state = { disposed: false };

      function render(a) {
        state.disposed = true; // 前の表示の読み込み結果を無視させる
        state = { disposed: false };
        if (a[0]) renderDraw(el, app, state, a[0]);
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
