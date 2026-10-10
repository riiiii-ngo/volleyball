/**
 * VolleyballStats
 * キャラクターのステータス(1〜99)と身長を、試合シミュレーションが使う物理量に変換する。
 * 「ステータスがどれだけ試合に効くか」の調整はこのファイルだけで行う。
 *
 * 速さ・高さは実際のバレーボール(高校〜大学男子)に近い値にしている。
 *   - 移動: 3.4〜5.4 m/秒(短い距離のダッシュ)
 *   - 最高到達点: 指高(身長×1.33)+ジャンプ(0.45〜1.05m)。身長180cm・ジャンプ50で約3.14m
 *   - スパイク: 初速 19〜31 m/秒、サーブ: フローター 15〜21 m/秒 / ジャンプサーブ 20〜30 m/秒
 * 狙いの正確さは「ブレの標準偏差(m)」で表し、ステータスが高いほど小さい(狙った所に行く)。
 * block はブロックで塞げる幅・ブロックの高さ・当たった時の結果に、power はスパイクの速さと
 * ブロックに打ち勝つ力(ブロックアウト)に効く。spike はスパイクの速さ(power と半分ずつ)と
 * 正確さ(technique と半分ずつ)に、stamina は試合中の疲れのたまりにくさに効く。
 */
(function (global) {
  'use strict';

  const DEFAULT_HEIGHT_CM = 180;

  function stat(stats, key) {
    const v = stats && stats[key];
    return typeof v === 'number' ? v : 50;
  }

  /**
   * @param {Object|null} stats - { speed, jump, power, receive, block, toss, serve, technique }
   * @param {number|null} [heightCm] - 身長(cm)。省略時は180
   */
  function toPlayParams(stats, heightCm) {
    const height = (typeof heightCm === 'number' && heightCm > 0 ? heightCm : DEFAULT_HEIGHT_CM) / 100;
    const standingReach = height * 1.33;                     // 指高(m)  180cm→2.39
    const jump = 0.45 + stat(stats, 'jump') * 0.006;         // 垂直跳び(m) 50→0.75 / 90→0.99
    const serve = stat(stats, 'serve');
    const power = stat(stats, 'power');
    const spike = stat(stats, 'spike');
    // サーブとパワーが高い選手はジャンプサーブ、それ以外はフローター
    const jumpServe = serve + power >= 130;
    return {
      speed: 2.8 + stat(stats, 'speed') * 0.03,              // 移動速度(m/秒)  25→3.55 / 50→4.3 / 75→5.05 / 99→5.77
      reach: 0.6 + stat(stats, 'receive') * 0.005,           // 飛びつける距離(m) 50→0.85 / 85→1.03
      jumpHeight: jump,
      attackReach: standingReach + jump,                     // スパイクの打点(m)  180cm・50→3.14
      blockTop: standingReach + jump * 0.85 + 0.05,          // ブロックの手の高さ(m)
      spikeSpeed: 17 + (power + spike) / 2 * 0.14,           // スパイクの初速(m/秒) 50→24 / 80→28.2
      jumpServe: jumpServe,
      serveSpeed: jumpServe ? 14 + (serve + power) / 2 * 0.17 : 13 + serve * 0.08, // 65→25 / 50→17
      // ---- 狙いのブレ(標準偏差, m) ----
      spikeError: 1.2 - (stat(stats, 'technique') + spike) / 2 * 0.01, // スパイク 50→0.7 / 70→0.5 / 99→0.21
      serveError: 1.1 - serve * 0.009,                       // サーブ     50→0.65 / 70→0.47
      passError: 1.5 - stat(stats, 'receive') * 0.012,       // レシーブの返球 50→0.9 / 85→0.48
      tossError: 0.9 - stat(stats, 'toss') * 0.008,          // トス       50→0.5  / 80→0.26
      // ブロックで塞げる幅(ブロッカーの中心から左右それぞれ, m)  50→0.55 / 80→0.7
      blockReach: 0.3 + stat(stats, 'block') * 0.005,
      // ブロックの当たり判定で使う元の値(ブロッカーのブロック値 vs 攻撃者のパワー値)
      blockPower: stat(stats, 'block'),
      attackPower: power,
      toss: stat(stats, 'toss'),
      // 疲れのたまりやすさ(1が基準)  50→1.0 / 65→0.82 / 80→0.64 / 99→0.41
      staminaRate: Math.max(0.3, 1.6 - stat(stats, 'stamina') * 0.012)
    };
  }

  global.VolleyballStats = Object.freeze({ toPlayParams: toPlayParams });
})(window);
