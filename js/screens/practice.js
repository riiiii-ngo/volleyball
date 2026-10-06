/**
 * フリー練習画面(3Dコート)。#/practice で表示する。
 * three.js とゲーム本体のスクリプトは、この画面に初めて入った時にだけ読み込む
 * (タイトル/メニューの表示を重くしないため)。離れる時は VolleyballGame の destroy() で
 * 描画ループと WebGL を確実に止める。
 * 出場チームは VolleyballData から読む(自チーム 'player'、相手 'cpu')。
 * ラリーが終わるたびにスコアを更新し、自チーム全員に経験値を与える(レベルアップはトーストで通知)。
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

  const REASON_LABELS = { in: '', out: 'OUT', net: 'NET', block: 'BLOCK', blockout: 'BLOCK OUT' };

  VolleyballApp.register('practice', {
    mount(el, args, app) {
      el.classList.add('court-screen');
      el.innerHTML =
        '<div class="court-view"></div>' +
        '<p class="court-loading">LOADING</p>' +
        '<div class="court-score" hidden>' +
          '<span class="court-score-team is-near"></span>' +
          '<span class="court-score-num is-near">0</span>' +
          '<span class="court-score-sep">-</span>' +
          '<span class="court-score-num is-far">0</span>' +
          '<span class="court-score-team is-far"></span>' +
          '<span class="court-score-reason"></span>' +
        '</div>' +
        '<button type="button" class="vb-back-btn">‹ メニュー</button>' +
        '<button type="button" class="vb-serve-btn" disabled>サーブ</button>' +
        '<button type="button" class="vb-receive-btn" disabled>レシーブ</button>';

      const loading = el.querySelector('.court-loading');
      const scoreEl = el.querySelector('.court-score');
      const score = { near: 0, far: 0 };
      let reasonTimer = null;
      let game = null;
      let disposed = false;

      el.querySelector('.vb-back-btn').addEventListener('click', () => app.go('menu', ['match']));

      Promise.all([
        app.loadScripts(GAME_SCRIPTS),
        VolleyballData.getTeam('player'),
        VolleyballData.getTeam('cpu')
      ]).then(([, nearTeam, farTeam]) => {
        if (disposed) return; // 読み込み中に画面を離れた
        loading.remove();
        game = VolleyballGame.init({
          container: el.querySelector('.court-view'),
          serveBtn: el.querySelector('.vb-serve-btn'),
          receiveBtn: el.querySelector('.vb-receive-btn'),
          joystickParent: el,
          nearTeam: nearTeam,
          farTeam: farTeam,
          onRallyEnd: result => onRallyEnd(result, nearTeam)
        });
        scoreEl.querySelector('.court-score-team.is-near').textContent = nearTeam.name;
        scoreEl.querySelector('.court-score-team.is-far').textContent = farTeam.name;
        scoreEl.hidden = false;
      }).catch(err => {
        if (disposed) return;
        loading.textContent = '読み込みに失敗しました';
        throw err; // エラーバナーにも出す
      });

      function onRallyEnd(result, nearTeam) {
        score[result.winner]++;
        scoreEl.querySelector('.court-score-num.is-near').textContent = score.near;
        scoreEl.querySelector('.court-score-num.is-far').textContent = score.far;
        scoreEl.classList.toggle('is-near-point', result.winner === 'near');
        scoreEl.classList.toggle('is-far-point', result.winner === 'far');
        const reasonEl = scoreEl.querySelector('.court-score-reason');
        reasonEl.textContent = REASON_LABELS[result.reason] || '';
        clearTimeout(reasonTimer);
        reasonTimer = setTimeout(() => { reasonEl.textContent = ''; }, 1500);

        // 自チーム全員に経験値。レベルが上がった選手をまとめて知らせる。
        const exp = result.winner === 'near' ? VolleyballProgression.EXP_RALLY_WIN : VolleyballProgression.EXP_RALLY_LOSE;
        VolleyballData.addExp(nearTeam.members.map(m => m.character.playerCharacterId), exp).then(results => {
          if (disposed) return;
          const ups = results.filter(r => r.levelsGained > 0);
          if (!ups.length) return;
          const first = ups[0].character;
          const who = first.name + (ups.length > 1 ? ' ほか' + (ups.length - 1) + '人' : '');
          app.toast('LEVEL UP! ' + who + ' Lv.' + first.level + '(育成ポイント+' + ups[0].pointsGained + ')');
        });
      }

      return {
        unmount() {
          clearTimeout(reasonTimer);
          disposed = true;
          if (game) game.destroy();
        }
      };
    }
  });
})();
