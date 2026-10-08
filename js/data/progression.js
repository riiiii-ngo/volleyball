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

  global.VolleyballProgression = Object.freeze({
    MAX_LEVEL: MAX_LEVEL,
    POINTS_PER_LEVEL: POINTS_PER_LEVEL,
    COST_STEP: COST_STEP,
    statUpCost: statUpCost,
    statUpTotalCost: statUpTotalCost,
    expToNext: expToNext,
    addExp: addExp
  });
})(window);
