/**
 * VolleyballStats
 * キャラクターのステータス(1〜99)を、試合シミュレーションが使う物理量に変換する。
 * 「ステータスがどれだけ試合に効くか」の調整はこのファイルだけで行う。
 *
 * 係数は、初期キャラ(ステータス40〜80程度)同士の試合で、コート内に落ちたスパイクを
 * 拾える率が相手・自チームとも7割弱になるように調整した(400ラリーの早送りで計測)。
 * パワーは効きすぎると全員のスパイクが速くなり誰も拾えなくなるので、効果を小さめにしている。
 * 狙いの正確さは「ブレの標準偏差(m)」で表し、ステータスが高いほど小さい(狙った所に行く)。
 * block はブロックで塞げる幅と、ブロックに当たった時の結果(シャット/ワンタッチ)に効く。
 * power はスパイクの速さに加え、ブロックに当たった時に打ち勝つ(ブロックアウト)力にも効く。
 */
(function (global) {
  'use strict';

  function stat(stats, key) {
    const v = stats && stats[key];
    return typeof v === 'number' ? v : 50;
  }

  /**
   * @param {Object|null} stats - { speed, jump, power, receive, block, toss, serve, technique }
   * @returns {{speed:number, reach:number, jumpHeight:number, spikeTime:number, serveTime:number,
   *            spikeError:number, serveError:number, passError:number, tossError:number,
   *            blockReach:number, blockPower:number, attackPower:number}}
   */
  function toPlayParams(stats) {
    return {
      speed: 2.6 + stat(stats, 'speed') * 0.02,           // 移動速度(m/秒)  50→3.6 / 75→4.1
      reach: 0.55 + stat(stats, 'receive') * 0.005,       // 飛びつける距離(m) 50→0.8 / 85→0.98
      jumpHeight: 0.3 + stat(stats, 'jump') * 0.005,      // スパイクのジャンプ高さ(m) 50→0.55
      spikeTime: 1.0 - stat(stats, 'power') * 0.002,      // スパイクの着地までの時間(秒) 50→0.9 / 75→0.85
      serveTime: 3.1 - stat(stats, 'serve') * 0.01,       // サーブの着地までの時間(秒) 50→2.6 / 70→2.4
      // ---- 狙いのブレ(標準偏差, m) ----
      spikeError: 1.3 - stat(stats, 'technique') * 0.011, // スパイク   50→0.75 / 70→0.53 / 99→0.21
      serveError: 1.2 - stat(stats, 'serve') * 0.01,      // サーブ     50→0.7  / 70→0.5
      passError: 1.4 - stat(stats, 'receive') * 0.011,    // レシーブの返球 50→0.85 / 85→0.47
      tossError: 0.9 - stat(stats, 'toss') * 0.008,       // トス       50→0.5  / 80→0.26
      // ブロックで塞げる幅(ブロッカーの中心から左右それぞれ, m)  50→0.55 / 80→0.7
      blockReach: 0.3 + stat(stats, 'block') * 0.005,
      // ブロックの当たり判定で使う元の値(ブロッカーのブロック値 vs 攻撃者のパワー値)
      blockPower: stat(stats, 'block'),
      attackPower: stat(stats, 'power')
    };
  }

  global.VolleyballStats = Object.freeze({ toPlayParams: toPlayParams });
})(window);
