/**
 * VolleyballProgression
 * 選手の成長ルール(経験値・レベル・育成ポイント)。数値の調整はこのファイルだけで行う。
 * 保存や読み込みには関わらない(それは VolleyballData の役目)。
 */
(function (global) {
  'use strict';

  const MAX_LEVEL = 50;
  const POINTS_PER_LEVEL = 1;  // レベルが1上がるごとにもらえる育成ポイント

  // ステータスを1上げるのに使う育成ポイント。そのステータスを育成で上げた回数に応じて段階的に増える。
  //   1〜5回目: 1pt、6〜10回目: 2pt、11〜15回目: 3pt …(COST_STEP 回ごとに +1)
  const COST_STEP = 5;

  /** 育成で bonus 回上げ済みのステータスを、もう1上げるのに必要なポイント。 */
  function statUpCost(bonus) {
    return Math.floor(Math.max(0, bonus) / COST_STEP) + 1;
  }

  /** 育成で bonus 回上げ済みのステータスを、さらに add 上げるのに必要なポイントの合計。 */
  function statUpTotalCost(bonus, add) {
    let total = 0;
    for (let i = 0; i < add; i++) total += statUpCost(bonus + i);
    return total;
  }

  // 今のレベルから次のレベルに上がるのに必要な経験値。Lv1→2: 100, Lv2→3: 120, …
  function expToNext(level) {
    return level >= MAX_LEVEL ? 0 : 80 + level * 20;
  }

  /**
   * 経験値を加えた結果を返す(引数は変更しない)。
   * @param {{level:number, exp:number, points:number}} progress
   * @param {number} amount
   * @returns {{level:number, exp:number, points:number, levelsGained:number, pointsGained:number}}
   */
  function addExp(progress, amount) {
    let level = progress.level;
    let exp = progress.exp + Math.max(0, Math.round(amount));
    let levelsGained = 0;
    while (level < MAX_LEVEL && exp >= expToNext(level)) {
      exp -= expToNext(level);
      level++;
      levelsGained++;
    }
    if (level >= MAX_LEVEL) exp = 0;
    const pointsGained = levelsGained * POINTS_PER_LEVEL;
    return {
      level: level,
      exp: exp,
      points: progress.points + pointsGained,
      levelsGained: levelsGained,
      pointsGained: pointsGained
    };
  }

  /** level(経験値 exp)から target レベルに上がるのに必要な経験値の合計。 */
  function expToReach(level, exp, target) {
    let total = 0;
    for (let l = level; l < Math.min(target, MAX_LEVEL); l++) total += expToNext(l);
    return Math.max(0, total - exp);
  }

  /**
   * 必要経験値 need を満たす経験値チケットの使い方を決める(一括レベルアップ用)。
   *   1. 経験値の多いチケットから順に、need を超えない範囲でできるだけ使う
   *   2. 残りは、足りる種類のうち超える分(無駄)が一番少ないもので埋める(同じなら経験値の多い方)。
   *      どの種類も1種類では足りなければ、経験値の多いチケットを使い切って繰り返す
   *   3. 最後に、経験値の少ないチケットから順に、外しても need を下回らない分を外す(無駄を減らす)
   * @param {number} need
   * @param {Array<{ id, value:number, count:number }>} stock - value は1枚の経験値、count は所持数
   * @returns {{ uses: Object<string, number>, total:number } | null} 所持チケット全部でも足りなければ null
   */
  function planExpTickets(need, stock) {
    const list = stock.filter(t => t.value > 0 && t.count > 0)
      .map(t => ({ id: t.id, value: t.value, left: t.count }))
      .sort((a, b) => b.value - a.value);
    if (list.reduce((sum, t) => sum + t.value * t.left, 0) < need) return null;
    const uses = {};
    let total = 0;
    function use(t, n) {
      if (n <= 0) return;
      uses[t.id] = (uses[t.id] || 0) + n;
      t.left -= n;
      total += t.value * n;
    }
    list.forEach(t => use(t, Math.min(t.left, Math.floor((need - total) / t.value))));
    while (total < need) {
      const rest = need - total;
      const fits = list.filter(t => t.left * t.value >= rest);
      if (fits.length) {
        const waste = t => Math.ceil(rest / t.value) * t.value - rest;
        const best = fits.reduce((a, b) => (waste(b) < waste(a) || (waste(b) === waste(a) && b.value > a.value) ? b : a));
        use(best, Math.ceil(rest / best.value));
      } else {
        use(list.find(t => t.left > 0), list.find(t => t.left > 0).left);
      }
    }
    list.slice().reverse().forEach(t => {
      const drop = Math.min(uses[t.id] || 0, Math.floor((total - need) / t.value));
      if (drop > 0) {
        uses[t.id] -= drop;
        total -= t.value * drop;
        if (!uses[t.id]) delete uses[t.id];
      }
    });
    return { uses: uses, total: total };
  }

  global.VolleyballProgression = Object.freeze({
    MAX_LEVEL: MAX_LEVEL,
    POINTS_PER_LEVEL: POINTS_PER_LEVEL,
    COST_STEP: COST_STEP,
    statUpCost: statUpCost,
    statUpTotalCost: statUpTotalCost,
    expToNext: expToNext,
    addExp: addExp,
    expToReach: expToReach,
    planExpTickets: planExpTickets
  });
})(window);
