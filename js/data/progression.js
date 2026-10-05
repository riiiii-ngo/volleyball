/**
 * VolleyballProgression
 * 選手の成長ルール(経験値・レベル・育成ポイント)。数値の調整はこのファイルだけで行う。
 * 保存や読み込みには関わらない(それは VolleyballData の役目)。
 */
(function (global) {
  'use strict';

  const MAX_LEVEL = 50;
  const POINTS_PER_LEVEL = 3;  // レベルが1上がるごとにもらえる育成ポイント

  // フリー練習でラリーが終わるたびに、自チーム全員がもらえる経験値
  const EXP_RALLY_WIN = 20;
  const EXP_RALLY_LOSE = 5;

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
    EXP_RALLY_WIN: EXP_RALLY_WIN,
    EXP_RALLY_LOSE: EXP_RALLY_LOSE,
    expToNext: expToNext,
    addExp: addExp
  });
})(window);
