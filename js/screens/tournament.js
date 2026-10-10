/**
 * トーナメント画面。#/tournament(最初の大会)または #/tournament/<トーナメントID> で表示する。
 * 出場前:大会の説明・出場校・報酬と「出場する」。出場中:組み合わせ(ラウンドごとの試合と結果)、次の試合と「試合へ」「棄権」。
 * 終了後:成績・獲得した報酬・優勝校と「もう一度出場する」。試合はフリー練習の画面(#/practice/tournament/<ID>)で行う。
 */
(function () {
  'use strict';

  const esc = VolleyballUI.escapeHtml;

  function rulesText(t) {
    const r = t.rules;
    return t.teamCount + 'チームの勝ち抜き戦 / ' + r.setsToWin + 'セット先取・' + r.setPoints + '点' +
      (r.finalSetPoints !== r.setPoints ? '(最終セット' + r.finalSetPoints + '点)' : '');
  }

  function itemsText(items) {
    return items.map(i => esc(i.item.name) + ' ×' + i.quantity).join('、') || 'なし';
  }

  // 1試合(2チームと結果)
  function matchHtml(m) {
    const setsWon = side => m.sets.filter(s => (side === 'a' ? s[0] > s[1] : s[1] > s[0])).length;
    const row = (team, side) =>
      '<span class="tour-team' + (team.isPlayer ? ' is-player' : '') + (m.winner === team.id ? ' is-winner' : '') + (m.winner && m.winner !== team.id ? ' is-loser' : '') + '">' +
        '<span class="tour-team-name">' + esc(team.name) + '</span>' +
        '<span class="tour-team-sets">' + (m.winner && m.sets.length ? setsWon(side) : '') + '</span>' +
      '</span>';
    return '<li class="tour-match' + (m.a.isPlayer || m.b.isPlayer ? ' has-player' : '') + '">' +
      row(m.a, 'a') + row(m.b, 'b') +
      (m.winner && m.sets.length
        ? '<span class="tour-match-sets">' + m.sets.map(s => s[0] + '-' + s[1]).join(' ') + '</span>'
        : m.winner ? '<span class="tour-match-sets">棄権</span>' : '') +
    '</li>';
  }

  function render(el, app, t, actions) {
    const e = t.entry;
    const content = el.querySelector('.roster-content');
    el.querySelector('.menu-heading-ja').textContent = t.name;
    let top = '';
    if (!e || e.status === 'finished') {
      top =
        (e ? '<div class="tour-result' + (e.placement === 1 ? ' is-champion' : '') + '">' +
          '<p class="tour-result-title">' + esc(e.placementLabel) + '</p>' +
          '<p class="tour-result-reward">獲得:' + itemsText(e.rewards) + '</p>' +
          (e.champion && e.placement !== 1 ? '<p class="tour-result-champion">優勝:' + esc(e.champion.name) + '</p>' : '') +
        '</div>' : '') +
        '<button type="button" class="training-btn is-apply tour-enter">' + (e ? 'もう一度出場する' : '出場する') + '</button>';
    } else if (e.nextMatch) {
      top =
        '<div class="tour-next">' +
          '<p class="tour-next-label">次の試合<b>' + esc(e.nextMatch.roundName) + '</b></p>' +
          '<p class="tour-next-opponent">vs ' + esc(e.nextMatch.opponent.name) + '</p>' +
          '<div class="training-actions">' +
            '<button type="button" class="training-btn is-reset tour-withdraw">棄権</button>' +
            '<button type="button" class="training-btn is-apply tour-play">試合へ</button>' +
          '</div>' +
        '</div>';
    }
    content.innerHTML =
      '<div class="tour-panel">' +
        '<p class="training-hint">' + esc(rulesText(t)) + '。負けたらその時点の成績で報酬がもらえます。試合のスタメンは「チーム > スタメン設定」の編成です。</p>' +
        top +
        (e
          ? '<p class="training-section-title">組み合わせ</p>' +
            e.rounds.map(r => '<p class="tour-round-name">' + esc(r.name) + '</p><ul class="tour-matches">' + r.matches.map(matchHtml).join('') + '</ul>').join('')
          : '<p class="training-section-title">出場校</p>' +
            '<ul class="tour-teams">' + ['マイチーム'].concat(t.teams.map(x => x.name)).map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>') +
        '<p class="training-section-title">報酬</p>' +
        '<ul class="tour-rewards">' + t.rewards.map(r =>
          '<li><span>' + esc(r.label) + '</span><b>' + itemsText(r.items) + '</b></li>').join('') +
        '</ul>' +
      '</div>';
    const on = (sel, fn) => { const b = content.querySelector(sel); if (b) b.addEventListener('click', fn); };
    on('.tour-enter', actions.enter);
    on('.tour-play', () => app.go('practice', ['tournament', t.id]));
    on('.tour-withdraw', actions.withdraw);
  }

  VolleyballApp.register('tournament', {
    mount(el, args, app) {
      el.classList.add('menu-screen', 'roster-screen', 'tournament-screen');
      el.innerHTML =
        '<header class="menu-header">' +
          '<button type="button" class="roster-back">‹ 試合</button>' +
          '<h1 class="menu-heading">' +
            '<span class="menu-heading-en">TOURNAMENT</span>' +
            '<span class="menu-heading-ja">トーナメント</span>' +
          '</h1>' +
        '</header>' +
        '<main class="menu-content roster-content"><p class="roster-status">LOADING</p></main>';
      el.querySelector('.roster-back').addEventListener('click', () => app.go('menu', ['match']));
      const content = el.querySelector('.roster-content');
      let disposed = false;
      let busy = false;
      let tournamentId = args[0] || null;

      function show(t) {
        if (disposed) return;
        render(el, app, t, actions);
      }
      function run(promise) {
        if (busy) return;
        busy = true;
        promise.then(show).catch(err => app.toast(err.message)).then(() => { busy = false; });
      }
      const actions = {
        enter() { run(VolleyballData.enterTournament(tournamentId)); },
        withdraw() {
          if (!window.confirm('棄権しますか?(この試合は負けになり、ここまでの成績で大会が終わります)')) return;
          run(VolleyballData.withdrawTournament(tournamentId));
        }
      };

      (tournamentId ? VolleyballData.getTournament(tournamentId) : VolleyballData.getTournaments().then(list => {
        if (!list.length) throw new Error('開催中のトーナメントはありません');
        tournamentId = list[0].id;
        return list[0];
      })).then(show).catch(err => {
        if (disposed) return;
        content.innerHTML = '<p class="roster-status is-error">' + esc(err.message) + '</p>';
      });

      return {
        unmount() { disposed = true; }
      };
    }
  });
})();
