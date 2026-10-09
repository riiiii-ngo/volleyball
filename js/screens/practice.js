/**
 * フリー練習画面(3Dコート)。#/practice で表示する。
 * three.js とゲーム本体のスクリプトは、この画面に初めて入った時にだけ読み込む
 * (タイトル/メニューの表示を重くしないため)。離れる時は VolleyballGame の destroy() で
 * 描画ループと WebGL を確実に止める。
 * 出場チームは VolleyballData から読む(自チーム 'player'、相手 'cpu')。
 * 試合は2セット先取(25点・最終セット15点、2点差)。得点・セット数・サーブ権を上部に表示し、
 * 試合が終わったら結果(もう一度 / メニューへ)を出す(試合では経験値は入らない。レベルは経験値チケットでだけ上がる)。
 */
(function () {
  'use strict';

  // 依存順(上から順に読み込む)。
  const GAME_SCRIPTS = [
    'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
    'js/court.js',
    'js/players.js',
    'js/joystick.js',
    'js/ball.js',
    'js/simulation.js',
    'js/stats.js',
    'js/game.js'
  ];

  const REASON_LABELS = { in: '', out: 'OUT', net: 'NET', block: 'BLOCK', blockout: 'BLOCK OUT', ace: 'SERVICE ACE' };

  VolleyballApp.register('practice', {
    hideHeader: true,
    mount(el, args, app) {
      el.classList.add('court-screen');
      el.innerHTML =
        '<div class="court-view"></div>' +
        '<p class="court-loading">LOADING</p>' +
        '<div class="court-score" hidden>' +
          '<span class="court-score-team is-near"></span>' +
          '<span class="court-score-setno"></span>' +
          '<span class="court-score-sets is-near">0</span>' +
          '<span class="court-score-num is-near">0</span>' +
          '<span class="court-score-sep">-</span>' +
          '<span class="court-score-num is-far">0</span>' +
          '<span class="court-score-sets is-far">0</span>' +
          '<span class="court-score-team is-far"></span>' +
          '<span class="court-score-reason"></span>' +
        '</div>' +
        '<div class="court-banner" hidden></div>' +
        '<div class="court-result" hidden>' +
          '<div class="court-result-box">' +
            '<p class="court-result-title"></p>' +
            '<p class="court-result-sets"></p>' +
            '<div class="court-result-buttons">' +
              '<button type="button" class="court-result-again">もう一度</button>' +
              '<button type="button" class="court-result-menu">メニューへ</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="vb-back-btn">‹ メニュー</button>' +
        '<button type="button" class="vb-serve-btn" disabled>サーブ</button>';

      const loading = el.querySelector('.court-loading');
      const scoreEl = el.querySelector('.court-score');
      const bannerEl = el.querySelector('.court-banner');
      const resultEl = el.querySelector('.court-result');
      const q = sel => scoreEl.querySelector(sel);
      let reasonTimer = null;
      let bannerTimer = null;
      let game = null;
      let teams = null;
      let disposed = false;
      let shownSets = 0;

      el.querySelector('.vb-back-btn').addEventListener('click', () => app.go('menu', ['match']));
      el.querySelector('.court-result-menu').addEventListener('click', () => app.go('menu', ['match']));
      el.querySelector('.court-result-again').addEventListener('click', () => {
        resultEl.hidden = true;
        startGame();
      });

      Promise.all([
        app.loadScripts(GAME_SCRIPTS),
        VolleyballData.getTeam('player'),
        VolleyballData.getTeam('cpu')
      ]).then(([, nearTeam, farTeam]) => {
        if (disposed) return; // 読み込み中に画面を離れた
        loading.remove();
        teams = { near: nearTeam, far: farTeam };
        q('.court-score-team.is-near').textContent = nearTeam.name;
        q('.court-score-team.is-far').textContent = farTeam.name;
        scoreEl.hidden = false;
        startGame();
      }).catch(err => {
        if (disposed) return;
        loading.textContent = '読み込みに失敗しました';
        throw err; // エラーバナーにも出す
      });

      function startGame() {
        if (game) game.destroy();
        shownSets = 0;
        game = VolleyballGame.init({
          container: el.querySelector('.court-view'),
          serveBtn: el.querySelector('.vb-serve-btn'),
          joystickParent: el,
          nearTeam: teams.near,
          farTeam: teams.far,
          onRallyEnd: onRallyEnd,
          onScore: onScore
        });
      }

      function onRallyEnd(result) {
        scoreEl.classList.toggle('is-near-point', result.winner === 'near');
        scoreEl.classList.toggle('is-far-point', result.winner === 'far');
        const reasonEl = q('.court-score-reason');
        reasonEl.textContent = REASON_LABELS[result.reason] || '';
        clearTimeout(reasonTimer);
        reasonTimer = setTimeout(() => { reasonEl.textContent = ''; }, 1500);
      }

      function showBanner(text, ms) {
        bannerEl.textContent = text;
        bannerEl.hidden = false;
        clearTimeout(bannerTimer);
        if (ms) bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, ms);
      }

      // 得点・セット・サーブ権の表示。セットが終わったらバナー、試合が終わったら結果を出す
      function onScore(state) {
        q('.court-score-num.is-near').textContent = state.score.near.points;
        q('.court-score-num.is-far').textContent = state.score.far.points;
        q('.court-score-sets.is-near').textContent = state.score.near.sets;
        q('.court-score-sets.is-far').textContent = state.score.far.sets;
        q('.court-score-setno').textContent = 'SET ' + state.setNumber;
        q('.court-score-num.is-near').classList.toggle('is-serving', state.servingSide === 'near');
        q('.court-score-num.is-far').classList.toggle('is-serving', state.servingSide === 'far');
        if (state.setResults.length > shownSets) {
          shownSets = state.setResults.length;
          const r = state.setResults[shownSets - 1];
          // セットを取った直後はそのセットの得点を残して見せる
          q('.court-score-num.is-near').textContent = r.near;
          q('.court-score-num.is-far').textContent = r.far;
          if (state.matchWinner) {
            bannerEl.hidden = true;
            showResult(state);
          } else {
            showBanner('SET ' + shownSets + '  ' + r.near + ' - ' + r.far, 3500);
          }
        }
      }

      function showResult(state) {
        const win = state.matchWinner === 'near';
        const title = resultEl.querySelector('.court-result-title');
        title.textContent = win ? 'WIN' : 'LOSE';
        title.classList.toggle('is-win', win);
        resultEl.querySelector('.court-result-sets').textContent =
          state.setResults.map(r => r.near + '-' + r.far).join('  ');
        resultEl.hidden = false;
      }

      return {
        unmount() {
          clearTimeout(reasonTimer);
          clearTimeout(bannerTimer);
          disposed = true;
          if (game) game.destroy();
        }
      };
    }
  });
})();
