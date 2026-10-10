/**
 * VolleyballSimulation
 * 試合の状態(ボールの飛行、12人+リベロの動き、得点・セット・ローテーション)を管理する純粋なロジック層。
 * THREE.js のシーングラフやDOMには一切触れない。
 *
 * 実際の6人制バレーボールに近づけるため、次のルールで動く。
 *   - 両チームとも同じ仕組み(近チーム=手前/プレイヤー操作、奥チーム=CPU)。サーブ権・ローテーション・
 *     得点・セットを管理し、サイドアウトを取ったチームが時計回りにローテーションしてサーブを打つ。
 *   - 5-1システム: 選手はサーブ順に S(セッター)→OH1→MB1→OP→OH2→MB2。前衛/後衛はローテーションで決まり、
 *     ラリーが始まると前衛は レフト=OH / センター=MB / ライト=S か OP、後衛は ライト=S か OP / センター=OH /
 *     レフト=リベロ(MB) の専門の位置へ移る(スイッチ)。リベロは後衛のMBと入れ替わる(MBのサーブの時を除く)。
 *   - ボールは重力のある放物線(初速と重力)で飛ぶ。ネット(白帯+ボール半径)にかかるとネット、
 *     アンテナの外を通るとアウト。
 *   - 1本目(レシーブ・ディグ)の返球のずれでA/B/Cパスが決まり、トスの選択肢が変わる
 *     (A: クイックを含む全部 / B: サイドとバックアタック / C: 二段トスでサイドの高いトスだけ)。
 *     セッターが1本目を触った・間に合わない時は、他の選手がアンダーで二段トスを上げる。
 *   - Aパスの時はMBがクイックに入る(上がらなくてもおとりになる)。CPUのMBは一定の確率でクイックに
 *     つられて跳び(コミット)、他の攻撃のブロックに遅れる。
 *   - ブロックはトスが上がってから打点へ走って跳ぶ。打つ瞬間に手がネットの上にあり、コースが手の
 *     範囲を通り、打球が手より低ければ当たり判定(シャット/ワンタッチ/ブロックアウト)。
 *   - 守備はブロックに合わせたペリメーター(ストレート・クロス・後ろ・フェイントカバー)。
 *     自チームが打つ時は残りの選手が打った選手の周りにカバーに入る。
 *   - 打球が向かってくると、反応時間の後、間に合う選手(ポジションの優先度込み)が落下点へ走る。
 *     触る高さ(レシーブは腰、トスは頭上)まで落ちてくるまでに飛びつける距離へ入れれば触れる。
 *   - ジャンプ・レシーブ・全力の移動で疲れがたまり(スタミナが高いほどたまりにくい)、走る速さ・ジャンプ・
 *     打球の速さ・狙いの正確さが下がる。点の間・セット間に回復する。
 *
 * 将来オンライン対戦にする場合は、この層が「権威のある状態」を持つ側(サーバー or ホスト)になり、
 * getState() のスナップショットを相手に送る、という使い方を想定している。
 */
(function (global) {
  'use strict';

  const G = 9.8;
  // ドライブ回転で落ちる分の下向きの加速度(m/秒²)。これが無いと速いサーブ・スパイクはコートに収まらない
  const TOPSPIN_JUMP_SERVE = 7;
  const TOPSPIN_SPIKE = 6;

  // ---- 触る高さ(m) ----
  const PASS_H = 0.8;          // レシーブ(アンダーハンド)
  const SET_H = 2.35;          // セッターのトス(オーバーハンド)
  const BUMP_SET_H = 1.0;      // セッター以外が上げる二段トス(アンダー)
  const FLOAT_SERVE_H = 2.6;   // フローターサーブの打点
  const HAND_H = 1.1;          // サーブ前にボールを持っている高さ

  // ---- 時間(秒) ----
  const REACTION = 0.25;       // 相手が打ってから動き出すまで
  const SERVE_REACTION = 0.3;  // サーブが打たれてから動き出すまで
  const SERVE_REACH_RATE = 0.8; // サーブレシーブは体の正面で受けるので、飛びつける距離をこの割合にする
  const DIG_REACH_TOLERANCE = 0.1; // 触る瞬間の距離の判定のゆとり(フレームの区切りで届かなくならないように)
  // サーブレシーブを弾いてしまう(コートの外へ飛ぶ=サービスエース)確率
  //   clamp((レシーブのブレ×サーブの難しさ − SHANK_BASE) × SHANK_RATE, 0, SHANK_MAX)、飛びついた時は + SHANK_STRETCH
  const SHANK_BASE = 0.9;
  const SHANK_RATE = 0.15;
  const SHANK_MAX = 0.12;
  const SHANK_STRETCH = 0.06;
  const TEAM_REACTION = 0.1;   // 味方の打球(パス・トス)に動き出すまで
  const JUMP_UP = 0.4;         // スパイクのジャンプ: 踏み切りから最高点(打点)まで
  const BLOCK_UP = 0.3;        // ブロックのジャンプ: 踏み切りから最高点まで
  const SERVE_TOSS_TIME = 0.55; // サーブのトスを上げてから打つまで
  const ACTION_HOLD = 1.2;     // 触ってから動作(モーション)を渡し続ける秒数
  const DEAD_HOLD = 1.2;       // ボールが落ちてから得点が入るまで
  const BETWEEN_POINTS = 2.2;  // 得点が入ってからサーブを打てるようになるまで(この間に次の陣形へ歩く)
  const CPU_SERVE_DELAY = 0.9; // サーブを打てるようになってからCPUが打つまで
  const SET_BREAK = 4.0;       // セット間

  // トスの速さ(上げてから打点に届くまでの秒数)
  const TEMPO = Object.freeze({ quick: 0.42, high: 1.25, back: 1.0, pipe: 1.0, highC: 1.6 });

  // ---- 立ち位置(チームのローカル座標。lx: そのチームから見て左が−・右が+ / d: ネットからの距離) ----
  const SETTER_TARGET = { lx: 1.0, d: 1.5 };   // レシーブの返球先(セッターがトスを上げる位置)
  const ATTACK_SPOTS = {                       // 打点(攻撃の種類ごと)
    left: { lx: -3.5, d: 0.7 },  // レフト(前衛OH)
    quick: { lx: 0.2, d: 0.55 }, // Aクイック(前衛MB)
    right: { lx: 3.5, d: 0.7 },  // ライト(前衛OP)
    pipe: { lx: 0, d: 3.6 },     // バックアタック(後衛OH。アタックラインの後ろから踏み切る)
    bic: { lx: 2.6, d: 3.6 }     // バックライト(後衛OP)
  };
  const APPROACH_STARTS = {                    // 助走を始める位置
    left: { lx: -4.3, d: 3.8 }, quick: { lx: 0.6, d: 2.7 }, right: { lx: 4.3, d: 3.8 },
    pipe: { lx: 0, d: 7.0 }, bic: { lx: 3.0, d: 7.0 }
  };
  // ラリー中の基本の守備位置(専門の位置。FL=前衛レフト … BR=後衛ライト)
  const BASE = {
    FL: { lx: -2.6, d: 0.9 }, FM: { lx: 0, d: 0.9 }, FR: { lx: 2.6, d: 0.9 },
    BL: { lx: -2.8, d: 6.4 }, BM: { lx: 0, d: 7.8 }, BR: { lx: 2.8, d: 6.4 }
  };
  // ローテーションの位置(サーブ前)。1=後衛ライト(サーバー) 2=前衛ライト 3=前衛センター 4=前衛レフト 5=後衛レフト 6=後衛センター
  const ZONE_SPOT = {
    1: { lx: 3, d: 6.2 }, 2: { lx: 3, d: 1.2 }, 3: { lx: 0, d: 1.2 },
    4: { lx: -3, d: 1.2 }, 5: { lx: -3, d: 6.2 }, 6: { lx: 0, d: 6.2 }
  };
  const SERVE_SPOT = { lx: 2.2, d: 10.4 };     // サーブを打つ位置(エンドラインの外)

  // ---- 狙い ----
  const MAX_ERROR_SIGMA = 2.5;       // ブレは標準偏差のこの倍数までで打ち切る
  const SET_ERROR_TO_SPIKE = 0.5;    // トスがずれた距離のこの割合だけ、スパイクのブレが大きくなる
  const PASS_NET_SIDE_ERROR = 0.5;   // レシーブの返球がネット側へずれる時は、ずれをこの割合に小さくする(ネットを越えにくい)
  const SPIKE_NET_MARGIN = 0.25;     // スパイクは狙った所へ白帯からこれだけ上を通して打つ(近くを狙う時は遅くして山なりに)
  const SPIKE_HEIGHT_ERROR = 0.5;    // スパイクの打ち出しの上下のブレ(m/秒, ×スパイクのブレ)。ネット・オーバーの原因
  const FREE_BALL_SET_ERROR = 1.3;   // トスがこれ以上ずれると打てず、チャンスボールで返す
  const TIP_DEPTH = 2.5;             // 操作中のチームはネットからこれより手前を狙うとフェイントになる
  const CPU_AIM_MARGIN = 0.4;        // CPUのスパイクはラインからこれだけ内側を狙う
  const CPU_AIM_CANDIDATES = 6;      // CPUは狙いの候補をこの数だけ考え、ブロックの無いコースで守備から一番遠い所を選ぶ
  const CPU_TIP_RATE = 0.06;         // CPUがフェイントを選ぶ確率(2枚ブロックの時は+0.06)
  const CPU_DUMP_RATE = 0.06;        // 前衛セッターがAパスをツーアタックする確率
  const CPU_COMMIT_RATE = 0.4;       // CPUのMBが相手のクイックにつられて跳ぶ確率
  const CPU_LATE_ADJUST = 0.2;       // CPUのスパイクは打つコースをトスの時に決める。決めたコースがブロックで塞がれていたら、打つ瞬間にこの確率で変える
  const BLOCK_READ = 0.6;            // CPUのブロックは、操作中のチームの打つ選手の向き(狙い)を読んで、そのコースへこの割合だけ寄る
  const DIG_READ = 0.35;             // 守備は打つ選手の向き(狙い)を読み、狙いに一番近い選手がそちらへこの割合だけ寄る(最大 DIG_READ_MAX m)
  const DIG_READ_MAX = 1.5;
  const FACE_AFTER_HIT = 0.3;        // 打った後もしばらく打った方向を向いたままにする
  const OUT_JUDGE_MARGIN = 0.15;     // 相手の打球がこれ以上外に落ちる時は見送る

  // ---- 選手の動き ----
  const JOG = 0.75;                  // 陣形へ戻る時は全力の何割で走るか
  const BLOCK_CONTROL_SPEED = 3.5;   // 操作中のチームのMBをジョイスティックで動かす速さ(m/秒)
  const BLOCK_NET_D = 0.4;           // ブロックに跳ぶ位置のネットからの距離

  // ---- ブロックの当たり判定 ----
  // diff = ブロッカーのブロック値 − 攻撃者のパワー値、n = 跳んでいるブロッカーの枚数
  //   当たる確率      = clamp(0.55 + diff*0.01 + (n-1)*0.1, 0.3, 0.92)
  //   当たった時: シャット = clamp(0.3 + diff*0.01, 0.1, 0.6)、ブロックアウト = clamp(0.15 - diff*0.005, 0.05, 0.3)、残りはワンタッチ
  const BLOCK_TOUCH_BASE = 0.55;
  const BLOCK_STUFF_BASE = 0.3;
  const BLOCK_OUT_BASE = 0.15;
  const BLOCK_OVER_MARGIN = 0.1;     // 打球がブロックの手よりこれ以上高く通ると当たらない

  // ---- 疲れ(0〜1。スタミナが高いほどたまりにくい) ----
  // たまる量 × 選手の staminaRate(スタミナ50→1.0 / 80→0.64)。ラリー中にたまり、能力にはラリーの間に反映する。
  const FATIGUE_JUMP = 0.01;         // ジャンプ1回(スパイク・ブロック・ジャンプサーブ)
  const FATIGUE_DIG = 0.004;         // レシーブ1回(飛びついた時は2倍)
  const FATIGUE_RUN = 0.0015;        // 全力で走った1mごと
  const RECOVER_POINT = 0.005;       // 1点ごとに回復(コートの選手)
  const RECOVER_BENCH = 0.03;        // 1点ごとに回復(リベロと交代してベンチにいる選手)
  const RECOVER_SET_BREAK = 0.3;     // セット間に回復
  // 疲れが1の時の能力の下がり方(疲れに比例)
  const TIRED_SPEED = 0.1;           // 走る速さ −10%
  const TIRED_JUMP = 0.2;            // ジャンプの高さ −20%(打点・ブロックの高さ)
  const TIRED_POWER = 0.08;          // スパイク・サーブの速さ −8%
  const TIRED_ERROR = 0.3;           // 狙いのブレ(スパイク・サーブ・レシーブ・トス) +30%

  // ステータス50・身長180cm相当(VolleyballStats.toPlayParams と同じ形)
  const DEFAULT_ABILITY = Object.freeze({
    speed: 4.3, reach: 0.85, jumpHeight: 0.75, attackReach: 3.14, blockTop: 3.08,
    spikeSpeed: 24, jumpServe: false, serveSpeed: 17,
    spikeError: 0.7, serveError: 0.65, passError: 0.9, tossError: 0.5,
    blockReach: 0.55, blockPower: 50, attackPower: 50, toss: 50, staminaRate: 1
  });

  const ROLE_ORDER = ['S', 'OH', 'MB', 'OP', 'OH', 'MB']; // サーブ順の役割(5-1システム)

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function hypot2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // 標準正規分布の乱数(Box-Muller)
  function gaussian() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }
  function scatter(p, sigma) {
    return {
      x: p.x + clamp(gaussian(), -MAX_ERROR_SIGMA, MAX_ERROR_SIGMA) * sigma,
      y: p.y,
      z: p.z + clamp(gaussian(), -MAX_ERROR_SIGMA, MAX_ERROR_SIGMA) * sigma
    };
  }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  // 円形のジョイスティック入力を正方形の可動範囲いっぱいまで届くように引き伸ばす(対角=コートの隅)
  function discToSquare(x, y) {
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const mag = Math.min(1, Math.hypot(x, y));
    const scale = mag / Math.max(Math.abs(x), Math.abs(y));
    return { x: x * scale, y: y * scale };
  }

  // ---- 放物線 ----
  // from から to へ T 秒で届く初速(g: 下向きの加速度。回転の分を含む)
  function ballistic(from, to, T, g) {
    const gg = g || G;
    return { x: (to.x - from.x) / T, y: (to.y - from.y + 0.5 * gg * T * T) / T, z: (to.z - from.z) / T };
  }
  function posAt(f, t) {
    const g = f.g || G;
    return { x: f.p0.x + f.v.x * t, y: f.p0.y + f.v.y * t - 0.5 * g * t * t, z: f.p0.z + f.v.z * t };
  }
  // 落ちてくる途中で高さ h を通る時刻(届かなければ null)
  function timeToHeight(f, h) {
    const g = f.g || G;
    const disc = f.v.y * f.v.y - 2 * g * (h - f.p0.y);
    if (disc < 0) return null;
    return (f.v.y + Math.sqrt(disc)) / g;
  }

  /**
   * @param {Object} config
   * @param {Object} config.dimensions - VolleyballCourt.DIMENSIONS 相当
   * @param {number} config.ballRadius - VolleyballBall.RADIUS 相当
   * @param {{near:Object, far:Object}} config.teams - 各チーム
   *        { members: [{ id, role:'S'|'OH'|'MB'|'OP'|'L', order:0〜5(リベロは null), ability }], rotationStart?: 1〜6 }
   *        order はサーブ順(0=S, 1=OH1, 2=MB1, 3=OP, 4=OH2, 5=MB2)。ability は VolleyballStats.toPlayParams の形。
   *        rotationStart はセッターの最初の位置(省略時1=後衛ライト)。
   * @param {string|null} [config.controlSide='near'] - プレイヤーが操作するチーム。null なら両チームCPU(早送りの検証用)
   * @param {{setsToWin?:number, setPoints?:number, finalSetPoints?:number}} [config.rules] - 既定は2セット先取・25点・最終セット15点
   * @param {string} [config.firstServe='near'] - 第1セットで最初にサーブを打つチーム
   * @param {Function} [config.onEvent] - 試合中の出来事の通知 (type, data)。画面の演出や早送りの集計に使う。
   *        'serve' {side, jump} / 'pass' {side, quality, kind} / 'set' {side, key, quality} / 'attack' {side, kind} /
   *        'block' {side(ブロックした側), result:'stuff'|'out'|'touch'} / 'net' {kind, side} /
   *        'rally' {winner, reason, serving, kind(最後の打球の種類)}
   */
  function create(config) {
    const d = config.dimensions;
    const R = config.ballRadius;
    const HALF_W = d.COURT_W / 2;
    const HALF_L = d.COURT_L / 2;
    const NET_CLEAR = d.NET_TOP + R;
    const rules = Object.assign({ setsToWin: 2, setPoints: 25, finalSetPoints: 15 }, config.rules || {});
    const control = config.controlSide === undefined ? 'near' : config.controlSide;
    const other = side => (side === 'near' ? 'far' : 'near');
    const emit = (type, data) => { if (config.onEvent) config.onEvent(type, data); };

    // ---------- チーム・選手 ----------
    function makeTeam(side, cfg) {
      const s = side === 'near' ? 1 : -1;
      const T = {
        side: side, s: s, order: [], libero: null, members: [], onCourt: [],
        rotStart: cfg.rotationStart || 1, rot: 0, points: 0, sets: 0,
        touches: 0, lastToucher: null, mbCommit: null, quickPlan: null
      };
      cfg.members.forEach(m => {
        const base = Object.assign({}, DEFAULT_ABILITY, m.ability || {});
        const p = {
          id: m.id, side: side, role: m.role, order: m.order,
          base: base, ab: Object.assign({}, base), fatigue: 0,
          x: 0, y: 0, z: 0, goal: null, moveSpeed: 0, jump: null, action: null,
          zone: null, slot: null, onCourt: false
        };
        T.members.push(p);
        if (m.role === 'L') T.libero = p; else T.order[m.order] = p;
      });
      for (let i = 0; i < 6; i++) {
        if (!T.order[i]) throw new Error('チーム ' + side + ' のサーブ順 ' + (i + 1) + ' 番目(' + ROLE_ORDER[i] + ')がいません');
      }
      return T;
    }
    const teams = { near: makeTeam('near', config.teams.near), far: makeTeam('far', config.teams.far) };
    const allPlayers = teams.near.members.concat(teams.far.members);

    // ---------- 疲れ ----------
    function tire(p, amount) { p.fatigue = clamp(p.fatigue + amount * p.base.staminaRate, 0, 1); }
    function recover(p, amount) { p.fatigue = clamp(p.fatigue - amount, 0, 1); }
    // 疲れを能力に反映する(ラリーの途中では変えない)
    function applyFatigue(p) {
      const b = p.base, f = p.fatigue;
      const jump = b.jumpHeight * (1 - TIRED_JUMP * f);
      const err = 1 + TIRED_ERROR * f;
      p.ab = Object.assign({}, b, {
        speed: b.speed * (1 - TIRED_SPEED * f),
        jumpHeight: jump,
        attackReach: b.attackReach - (b.jumpHeight - jump),
        blockTop: b.blockTop - (b.jumpHeight - jump) * 0.85,
        spikeSpeed: b.spikeSpeed * (1 - TIRED_POWER * f),
        serveSpeed: b.serveSpeed * (1 - TIRED_POWER * f),
        spikeError: b.spikeError * err,
        serveError: b.serveError * err,
        passError: b.passError * err,
        tossError: b.tossError * err
      });
    }

    // ローカル座標 ↔ ワールド座標
    function W(T, lx, dd) { return { x: T.s * lx, z: T.s * dd }; }
    function Wp(T, spot) { return W(T, spot.lx, spot.d); }
    function L(T, x, z) { return { lx: T.s * x, d: T.s * z }; }

    function zoneOf(T, i) { return ((T.rotStart - 1 + i - T.rot) % 6 + 6) % 6 + 1; }
    function isFrontZone(z) { return z >= 2 && z <= 4; }
    function specialistSlot(p) {
      const front = isFrontZone(p.zone);
      if (p.role === 'L') return 'BL';
      if (p.role === 'OH') return front ? 'FL' : 'BM';
      if (p.role === 'MB') return front ? 'FM' : 'BL';
      return front ? 'FR' : 'BR'; // S / OP
    }
    function bySlot(T, slot) { return T.onCourt.find(p => p.slot === slot) || null; }
    function setterOf(T) { return T.onCourt.find(p => p.role === 'S') || null; }
    function serverOf(T) { return T.onCourt.find(p => p.zone === 1) || null; }

    // ローテーションに合わせてコートに入る6人を決める(リベロは後衛のMBと交代。MBがサーブを打つ時は除く)
    function arrangeTeam(T) {
      T.members.forEach(p => { p.onCourt = false; p.zone = null; p.slot = null; });
      T.onCourt = [];
      T.order.forEach((p, i) => {
        p.zone = zoneOf(T, i);
        let q = p;
        if (T.libero && p.role === 'MB' && !isFrontZone(p.zone) && !(p.zone === 1 && servingSide === T.side)) {
          q = T.libero;
          q.zone = p.zone;
        }
        q.onCourt = true;
        T.onCourt.push(q);
      });
      T.onCourt.forEach(p => { p.slot = specialistSlot(p); });
      T.touches = 0;
      T.lastToucher = null;
      T.mbCommit = null;
      T.quickPlan = null;
    }

    // ---------- 選手の動き ----------
    function moveTo(p, pt, speedMul) {
      p.goal = { x: pt.x, z: pt.z };
      p.moveSpeed = p.ab.speed * (speedMul || 1);
    }
    function moveLocal(p, spot, speedMul) { moveTo(p, Wp(teams[p.side], spot), speedMul); }
    function startJump(p, at, up, h, kind) {
      p.jump = { start: at, up: up, h: h };
      tire(p, FATIGUE_JUMP);
      if (kind) act(p, kind, at + up);
    }
    // 見た目の動作(モーション)。kind の動作でボールに触る(跳ぶならジャンプの最高点の)時刻 at を覚えておき、
    // getState() で触る時刻からの経過時間として渡す(触る前の構え・助走の腕の振りも描けるように予定の時点で入れる)。
    //   'pass' レシーブ / 'dive' 飛びついてレシーブ / 'set' オーバーハンドのトス / 'bump' アンダーの二段トス /
    //   'spike' / 'tip' / 'block' / 'floatServe' / 'jumpServe'
    function act(p, kind, at) { p.action = { kind: kind, at: at }; }
    // 打球が変わったら、まだ触っていないレシーブ・トスの予定は取り消す(新しい打球で予定し直す)
    const FLIGHT_ACTIONS = { pass: true, dive: true, set: true, bump: true };
    function clearPlannedActions(at, all) {
      allPlayers.forEach(p => {
        if (p.action && p.action.at > at && (all || FLIGHT_ACTIONS[p.action.kind])) p.action = null;
      });
    }
    function airborne(p, at) { return !!p.jump && at >= p.jump.start && at < p.jump.start + 2 * p.jump.up; }
    function jumpY(p, at) {
      if (!p.jump) return 0;
      const u = (at - p.jump.start - p.jump.up) / p.jump.up;
      if (u < -1 || u > 1) return 0;
      return p.jump.h * (1 - u * u);
    }
    function updatePlayers(dt) {
      allPlayers.forEach(p => {
        if (p.goal) {
          const dx = p.goal.x - p.x, dz = p.goal.z - p.z;
          const dist = Math.hypot(dx, dz);
          const step = p.moveSpeed * dt;
          if (p.moveSpeed >= p.ab.speed * 0.95) tire(p, Math.min(dist, step) * FATIGUE_RUN);
          if (dist <= step) { p.x = p.goal.x; p.z = p.goal.z; p.goal = null; }
          else { p.x += dx / dist * step; p.z += dz / dist * step; }
        }
        p.y = jumpY(p, time);
        if (p.jump && time > p.jump.start + 2 * p.jump.up) p.jump = null;
      });
    }

    // ---------- 時間とイベント ----------
    // 予定した処理(触る瞬間・ジャンプ・着地など)。scope:
    //   'flight' … 次の打球が始まったら取り消す(触る予定・その打球に対する動き)
    //   'rally'  … ラリーが終わったら取り消す(クイックのおとりなど、打球をまたぐ予定)
    //   'match'  … 取り消さない(得点・次のサーブの準備)
    let time = 0;
    let events = [];
    let flightToken = 0;
    let rallyToken = 0;
    function schedule(at, fn, scope) {
      const e = { at: at, fn: fn, scope: scope || 'flight', flight: flightToken, rally: rallyToken };
      let i = events.length;
      while (i > 0 && events[i - 1].at > at) i--;
      events.splice(i, 0, e);
    }
    function processEvents() {
      while (events.length && events[0].at <= time) {
        const e = events.shift();
        if (e.scope === 'flight' && e.flight !== flightToken) continue;
        if (e.scope !== 'match' && e.rally !== rallyToken) continue;
        e.fn(e.at);
      }
    }

    // ---------- 試合の状態 ----------
    let servingSide = config.firstServe || 'near';
    let firstServeOfSet = servingSide;
    let setNumber = 1;
    const setResults = [];          // [{ near, far }] 終わったセットの得点
    let matchWinner = null;
    let phase = 'between';          // 'between' | 'preServe' | 'serving' | 'rally' | 'dead' | 'setBreak' | 'matchOver'
    let rallyCount = 0;
    let lastRally = null;           // { winner, reason }
    let scoreVersion = 0;
    let flight = null;              // 飛んでいるボール
    let ballDead = null;            // ラリー終了後に床に置いておく位置
    const ballSpin = { x: 0, z: 0 };

    // 操作中のチーム
    const target = { x: 0, z: 0 };  // サーブ・スパイクの狙い(相手コート)
    let setChoice = null;           // トス方向の選択中 { zones, zone, quality, deadline }
    let aiming = false;             // 自チームのトスが上がって、スパイクの狙いを決めている間
    let aimDeadline = 0;            //   打つ時刻
    let blockControl = false;       // 相手のトス〜スパイクの間、自チームのMBを左右に動かせる
    let blockDeadline = 0;          //   ブロックに跳ぶ時刻
    if (control) {
      const t0 = W(teams[other(control)], 0, HALF_L / 2);
      target.x = t0.x; target.z = t0.z;
    }

    // ---------- 打球 ----------
    // f = { kind, side(打ったチーム), p0, v, t0, landT, crossT?, cross?, netT?, fault?, touchNo, isBlock?, ... }
    function launch(kind, side, from, to, T, extra, at) {
      const f = Object.assign({ kind: kind, side: side, p0: { x: from.x, y: from.y, z: from.z }, v: ballistic(from, to, T) }, extra || {});
      startFlight(f, at);
      return f;
    }

    function startFlight(f, at) {
      flightToken++;
      clearPlannedActions(at, false);
      flight = f;
      f.t0 = at;
      ballDead = null;
      if (f.kind === 'serveToss') return; // サーブのトス(見た目だけ)
      f.landT = timeToHeight(f, R);
      // ネットの面(z=0)を通るか
      if (Math.abs(f.v.z) > 1e-6) {
        const tc = -f.p0.z / f.v.z;
        if (tc > 0.001 && tc < f.landT) {
          const c = posAt(f, tc);
          f.crossT = tc;
          f.cross = c;
          if (c.y < NET_CLEAR && Math.abs(c.x) <= HALF_W + d.POLE_OUT) f.netT = tc;
          else if (Math.abs(c.x) > HALF_W) f.fault = 'out'; // アンテナの外を通った
        }
      }
      // レシーブ・トスは、ネットの面へ届く前に味方が触る予定なら自コートのボールとして扱う
      f.ownFirst = ownContactFirst(f);
      if (f.netT != null) schedule(at + f.netT, netHit);
      else {
        schedule(at + f.landT, landed);
        if (f.crossT != null && f.kind === 'attack') schedule(at + f.crossT, checkBlock);
        if (f.crossT != null && !f.ownFirst) schedule(at + f.crossT + 0.15, () => toDefenseBase(teams[f.side]));
      }
      if (f.ownFirst || (f.netT == null && !f.fault)) planNext(f, at);
    }

    function ownContactFirst(f) {
      if (f.crossT == null) return false;
      const h = f.kind === 'pass' ? SET_H : (f.kind === 'set' ? f.attacker.ab.attackReach : null);
      if (h == null) return false;
      const t = timeToHeight(f, h);
      return t != null && t < f.crossT;
    }

    function netHit(at) {
      const f = flight;
      const c = f.cross;
      const back = f.side === 'near' ? 1 : -1; // 打った側へ落ちる
      emit('net', { kind: f.kind, side: f.side });
      const nf = { kind: 'netFall', side: f.side, p0: { x: c.x, y: c.y, z: back * (R + 0.05) }, v: { x: 0, y: -0.5, z: back * 0.4 }, fault: 'net', origin: f.kind };
      flightToken++;
      flight = nf;
      nf.t0 = at;
      nf.landT = timeToHeight(nf, R);
      schedule(at + nf.landT, landed);
    }

    function isInCourt(p) {
      return Math.abs(p.x) <= HALF_W + R && Math.abs(p.z) <= HALF_L + R;
    }

    function landed(at) {
      const f = flight;
      const p = posAt(f, f.landT);
      ballDead = { x: p.x, y: R, z: p.z };
      flight = null;
      let winner, reason;
      if (f.fault) {
        winner = other(f.side);
        reason = f.fault;
      } else if (isInCourt(p)) {
        const landSide = p.z >= 0 ? 'near' : 'far';
        winner = other(landSide);
        reason = f.kind === 'blockStuff' ? 'block' : (f.kind === 'serve' ? 'ace' : 'in');
      } else {
        winner = other(f.side);
        reason = f.kind === 'blockOut' ? 'blockout' : (f.shank ? 'ace' : 'out');
      }
      endRally(winner, reason, at, f.origin || f.kind);
    }

    // ---------- 次に誰が触るか ----------
    function planNext(f, at) {
      if (f.kind === 'blockOut' || f.shank) return;
      const crosses = f.crossT != null && !f.ownFirst;
      if (f.kind === 'serve' && !crosses) return;
      const recvSide = crosses ? other(f.side) : f.side;
      const T = teams[recvSide];
      const touchNo = (crosses || f.isBlock) ? 1 : f.touchNo + 1;
      if (touchNo === 1) {
        // 相手の打球が外に落ちるなら見送る
        if (crosses && !isInCourt(shrink(posAt(f, f.landT), OUT_JUDGE_MARGIN))) return;
        planDig(T, f, at);
      } else if (touchNo === 2) {
        planSecond(T, f, at);
      } else if (f.kind === 'set') {
        planAttack(T, f, at);
      } else {
        planEmergency(T, f, at);
      }
    }
    // 判定用に、コートの内側へ margin だけ寄せた点(ライン際のボールは触りに行く)
    function shrink(p, margin) {
      return { x: p.x - Math.sign(p.x) * margin, y: p.y, z: p.z - Math.sign(p.z) * margin };
    }

    // 触る高さまで落ちてくる時刻と位置。ネットの向こう側で落ちてくる場合は少し後にずらす。
    function contactPoint(f, h, T) {
      let t = timeToHeight(f, h);
      if (t == null) t = f.landT - 0.02;
      let p = posAt(f, t);
      if (L(T, p.x, p.z).d < 0.2) { t = Math.max(t, f.landT - 0.05); p = posAt(f, t); }
      return { t: t, p: p };
    }

    // 間に合う選手(反応時間・移動・飛びつける距離)。penalty で役割の優先度を付ける。
    function chooseRunner(candidates, point, tAvail, reaction, at, penalty, reachRate) {
      let best = null;
      candidates.forEach(p => {
        if (airborne(p, at)) return;
        const need = Math.max(0, hypot2(p, point) - p.ab.reach * (reachRate || 1));
        const arrive = reaction + need / p.ab.speed;
        const cost = arrive + (penalty ? penalty(p) : 0);
        if (!best || cost < best.cost) best = { p: p, arrive: arrive, cost: cost };
      });
      if (!best) return null;
      best.ok = best.arrive <= tAvail;
      return best;
    }

    // 1本目(サーブレシーブ・ディグ・チャンスボール)
    function planDig(T, f, at) {
      const c = contactPoint(f, PASS_H, T);
      const isServe = f.kind === 'serve';
      const penalty = p => {
        if (p.role === 'S') return 0.3;                         // セッターはなるべく1本目を触らない
        if (isServe && p.role !== 'L' && p.role !== 'OH') return 0.4; // サーブレシーブはリベロとOHが受ける
        return 0;
      };
      const reaction = isServe ? SERVE_REACTION : REACTION;
      // サーブはセッターと前衛の非レシーバー(MB・OP)は受けない
      const cands = isServe ? T.onCourt.filter(p => p.role !== 'S' && (p.slot === 'FL' || !isFrontZone(p.zone))) : T.onCourt;
      const best = chooseRunner(cands, c.p, c.t, reaction, at, penalty, isServe ? SERVE_REACH_RATE : 1);
      if (!best) return;
      const p = best.p;
      schedule(at + reaction, () => moveTo(p, c.p));
      if (!best.ok) return; // 間に合わない(走るがボールは落ちる)
      // セッターはレシーブが上がる前から返球先へ向かう(ペネトレーション)
      const setter = setterOf(T);
      if (setter && setter !== p && !airborne(setter, at)) schedule(at + reaction, () => moveLocal(setter, SETTER_TARGET));
      const stretched = best.arrive > c.t - 0.15;
      act(p, stretched ? 'dive' : 'pass', at + c.t);
      schedule(at + c.t, cAt => digContact(T, p, f, cAt, stretched, isServe ? SERVE_REACH_RATE : 1));
    }

    // reachRate: 飛びつける距離に掛ける割合(サーブレシーブは体の正面で受けるので小さい)
    function digContact(T, p, f, at, stretched, reachRate) {
      const hit = posAt(f, at - f.t0);
      // レシーバーは走ってきた位置のまま触る(ボールの所へ瞬間移動しない)。
      // 触る瞬間に飛びつける距離に入っていなければ届かない(ボールはそのまま落ちる)
      if (hypot2(p, hit) > p.ab.reach * (reachRate || 1) + DIG_REACH_TOLERANCE) return;
      p.goal = null;
      T.touches = 1;
      T.lastToucher = p;
      act(p, stretched ? 'dive' : 'pass', at);
      tire(p, FATIGUE_DIG * (stretched ? 2 : 1));
      // 打球が速い・強いほど返球が乱れる
      const speed = Math.hypot(f.v.x, f.v.z);
      let factor;
      if (f.kind === 'serve') factor = f.serveFactor || 1;
      else if (f.kind === 'attack') factor = 1.45 + Math.max(0, speed - 20) * 0.04;
      else if (f.kind === 'blockStuff') factor = 1.6;
      else if (f.kind === 'blockTouch') factor = 0.8;
      else factor = 0.6; // フェイント・チャンスボール
      if (stretched) factor *= 1.25; // 飛びついた
      if (f.kind === 'serve') {
        const shank = clamp((p.ab.passError * factor - SHANK_BASE) * SHANK_RATE, 0, SHANK_MAX) + (stretched ? SHANK_STRETCH : 0);
        if (Math.random() < shank) {
          // 弾いてコートの外へ(横か後ろ)
          const sx = Math.random() < 0.5 ? -1 : 1;
          const out = Math.random() < 0.6 ? W(T, sx * (HALF_W + 1 + Math.random() * 2), L(T, hit.x, hit.z).d + Math.random() * 3)
            : W(T, (Math.random() * 2 - 1) * 3, HALF_L + 1 + Math.random() * 2);
          emit('pass', { side: T.side, quality: 'shank', kind: f.kind });
          launch('pass', T.side, hit, { x: out.x, y: R, z: out.z }, 0.9, { touchNo: 3, shank: true }, at);
          return;
        }
      }
      const aimXZ = Wp(T, SETTER_TARGET);
      const aim = { x: aimXZ.x, y: SET_H, z: aimXZ.z };
      const to = scatter(aim, p.ab.passError * factor);
      const toL = L(T, to.x, to.z);
      if (toL.d < SETTER_TARGET.d) { // ネット側へのずれは小さめ
        const w = W(T, toL.lx, SETTER_TARGET.d - (SETTER_TARGET.d - toL.d) * PASS_NET_SIDE_ERROR);
        to.x = w.x; to.z = w.z;
      }
      const dev = hypot2(to, aim);
      const quality = dev < 1.0 ? 'A' : (dev < 2.0 ? 'B' : 'C');
      const isDig = f.kind === 'attack' || f.kind === 'blockStuff';
      const T_ = (isDig ? 1.35 : 1.15) + hypot2(hit, to) * 0.02;
      emit('pass', { side: T.side, quality: quality, kind: f.kind });
      launch('pass', T.side, hit, to, T_, { touchNo: 1, quality: quality }, at);
    }

    // 2本目(トス)。セッターが間に合えばセッター、だめなら他の選手が二段トス。
    function planSecond(T, f, at) {
      const last = T.lastToucher;
      const setter = setterOf(T);
      let plan = null;
      if (setter && setter !== last) {
        const c = contactPoint(f, SET_H, T);
        const r = chooseRunner([setter], c.p, c.t, TEAM_REACTION, at);
        if (r && r.ok) plan = { p: setter, c: c, isSetter: true };
      }
      if (!plan) {
        const c = contactPoint(f, BUMP_SET_H, T);
        const r = chooseRunner(T.onCourt.filter(p => p !== last), c.p, c.t, TEAM_REACTION, at,
          p => (p.role === 'L' ? -0.2 : 0)); // リベロが優先して二段トスを上げる
        if (!r) return;
        schedule(at + TEAM_REACTION, () => moveTo(r.p, c.p));
        if (!r.ok) return;
        plan = { p: r.p, c: c, isSetter: false };
      } else {
        schedule(at + TEAM_REACTION, () => moveTo(plan.p, plan.c.p));
      }
      const quality = plan.isSetter ? (f.quality || 'B') : 'C';
      const options = setOptions(T, quality, plan.p);
      const setAt = at + plan.c.t;
      act(plan.p, plan.isSetter ? 'set' : 'bump', setAt);

      // Aパスで前衛MBがいればクイックに入る(上がらなければおとり)
      T.quickPlan = null;
      if (options.quick) {
        const mb = options.quick.p;
        const contactT = setAt + TEMPO.quick;
        const spot = ATTACK_SPOTS.quick;
        T.quickPlan = { p: mb, contactT: contactT };
        schedule(at + TEAM_REACTION, () => approach(mb, spot, contactT, at), 'rally');
        // 相手(CPU)のMBは一定の確率でクイックにつられて跳ぶ
        const D = teams[other(T.side)];
        const dmb = bySlot(D, 'FM');
        D.mbCommit = null;
        if (dmb && D.side !== control && Math.random() < CPU_COMMIT_RATE) {
          D.mbCommit = { landAt: contactT + BLOCK_UP + 0.1 };
          const q = Wp(T, spot);
          schedule(setAt, () => moveTo(dmb, { x: q.x, z: D.s * BLOCK_NET_D }, 0.9), 'rally');
          schedule(contactT - BLOCK_UP, jAt => startJump(dmb, jAt, BLOCK_UP, dmb.ab.jumpHeight * 0.8, 'block'), 'rally');
        }
      }
      transitionOffense(T, plan.p, at);
      // 相手チームはブロックに備えて基本の位置へ
      toDefenseBase(teams[other(T.side)]);

      if (T.side === control) {
        const zones = uiZones(options);
        setChoice = { zones: zones, zone: ['center', 'left', 'right'].find(z => zones[z].enabled) || 'left', quality: quality, options: options, deadline: setAt };
      }
      schedule(setAt, sAt => setContact(T, plan, f, options, quality, sAt));
    }

    // トスの選択肢。キーごとに { p: 打つ選手, spot, tempo, label }
    function setOptions(T, quality, setterP) {
      const isSetter = setterP.role === 'S';
      const o = {};
      const fl = bySlot(T, 'FL'), fm = bySlot(T, 'FM'), fr = bySlot(T, 'FR');
      const bm = bySlot(T, 'BM'), br = bySlot(T, 'BR');
      const ok = p => p && p !== setterP;
      const high = quality === 'C' || !isSetter;
      if (ok(fl)) o.left = { p: fl, spot: ATTACK_SPOTS.left, tempo: high ? TEMPO.highC : TEMPO.high, label: 'レフト' };
      if (ok(fr) && fr.role === 'OP') o.right = { p: fr, spot: ATTACK_SPOTS.right, tempo: high ? TEMPO.highC : TEMPO.back, label: 'ライト' };
      if (isSetter && quality === 'A' && ok(fm) && fm.role === 'MB') o.quick = { p: fm, spot: ATTACK_SPOTS.quick, tempo: TEMPO.quick, label: 'クイック' };
      if (isSetter && quality !== 'C' && ok(bm) && bm.role === 'OH') o.pipe = { p: bm, spot: ATTACK_SPOTS.pipe, tempo: TEMPO.pipe, label: 'バック' };
      if (isSetter && quality !== 'C' && ok(br) && br.role === 'OP') o.bic = { p: br, spot: ATTACK_SPOTS.bic, tempo: TEMPO.pipe, label: 'バックライト' };
      if (isSetter && quality === 'A' && isFrontZone(setterP.zone)) o.dump = { p: setterP, label: 'ツー' };
      if (!o.left && !o.right) { // 打てる選手がいなければ、誰でもいいので前衛へ高いトス
        const any = T.onCourt.find(p => p !== setterP && p.role !== 'L');
        if (any) o.left = { p: any, spot: ATTACK_SPOTS.left, tempo: TEMPO.highC, label: 'レフト' };
      }
      return o;
    }

    // ジョイスティックの3つのゾーン(レフト/センター/ライト)に割り当てる選択肢
    function uiZones(o) {
      const zone = opt => (opt ? { label: opt.label, enabled: true, key: null } : { label: '-', enabled: false, key: null });
      const left = zone(o.left); left.key = o.left ? 'left' : null;
      const cKey = o.quick ? 'quick' : (o.pipe ? 'pipe' : null);
      const center = zone(cKey && o[cKey]); center.key = cKey;
      const rKey = o.right ? 'right' : (o.bic ? 'bic' : null);
      const right = zone(rKey && o[rKey]); right.key = rKey;
      return { left: left, center: center, right: right };
    }

    // CPU のトスの配分
    function cpuSetChoice(o, quality) {
      if (o.dump && Math.random() < CPU_DUMP_RATE) return 'dump';
      const weights = { left: 3, quick: 2.5, right: 2.5, pipe: 1.2, bic: 1 };
      if (quality === 'C') { weights.left = 3; weights.right = 1.5; }
      const keys = Object.keys(weights).filter(k => o[k]);
      let total = 0;
      keys.forEach(k => { total += weights[k]; });
      let r = Math.random() * total;
      for (const k of keys) { r -= weights[k]; if (r <= 0) return k; }
      return keys[0];
    }

    // 1本目を上げた後、攻撃に備えて助走の位置へ(セッター・トスを上げる選手以外)
    function transitionOffense(T, setterP, at) {
      T.onCourt.forEach(p => {
        if (p === setterP || (T.quickPlan && T.quickPlan.p === p)) return;
        let spot = null;
        if (p.slot === 'FL') spot = APPROACH_STARTS.left;
        else if (p.slot === 'FM') spot = APPROACH_STARTS.quick;
        else if (p.slot === 'FR') spot = p.role === 'OP' ? APPROACH_STARTS.right : BASE.FR;
        else if (p.slot === 'BM') spot = p.role === 'OH' ? APPROACH_STARTS.pipe : BASE.BM;
        else if (p.slot === 'BR') spot = p.role === 'OP' ? APPROACH_STARTS.bic : BASE.BR;
        else spot = { lx: -2.2, d: 5.0 };
        const delay = p === T.lastToucher ? 0.25 : TEAM_REACTION;
        schedule(at + delay, () => moveLocal(p, spot));
      });
    }

    function toDefenseBase(T) {
      T.onCourt.forEach(p => {
        if (control === T.side && p.slot === 'FM' && blockControl) return;
        moveLocal(p, BASE[p.slot], JOG);
      });
    }

    // 助走: 打つ瞬間(contactT)に spot でジャンプの最高点になるように走って跳ぶ
    function approach(p, spot, contactT, at, worldSpot) {
      const T = teams[p.side];
      const c = worldSpot || Wp(T, spot);
      const take = worldSpot ? { x: c.x, z: c.z + T.s * 0.4 } : Wp(T, { lx: spot.lx, d: spot.d + 0.4 });
      const jumpAt = contactT - JUMP_UP;
      const runTime = Math.max(0.05, jumpAt - at);
      const dist = hypot2(p, take);
      p.goal = { x: take.x, z: take.z };
      p.moveSpeed = clamp(dist / runTime, p.ab.speed * 0.6, p.ab.speed * 1.3);
      act(p, 'spike', contactT);
      schedule(jumpAt, jAt => {
        startJump(p, jAt, JUMP_UP, p.ab.jumpHeight);
        moveTo(p, c, 0.5); // 空中で少し前へ流れる
      }, 'rally');
    }

    function setContact(T, plan, f, options, quality, at) {
      const p = plan.p;
      const hit = posAt(f, at - f.t0);
      p.x = hit.x; p.z = hit.z; p.goal = null;
      T.touches = 2;
      T.lastToucher = p;
      act(p, plan.isSetter ? 'set' : 'bump', at);
      let key;
      if (T.side === control && setChoice) key = setChoice.zones[setChoice.zone].key || setChoice.zones.left.key;
      else key = cpuSetChoice(options, quality);
      setChoice = null;
      if (!key || !options[key]) key = options.left ? 'left' : Object.keys(options).find(k => k !== 'dump');
      emit('set', { side: T.side, key: key, quality: quality });
      if (key === 'dump') { attackBy(T, p, hit, at, 'tip', 0); return; }
      const opt = options[key];
      const attacker = opt.p;
      const aimXZ = Wp(T, opt.spot);
      const aim = { x: aimXZ.x, y: attacker.ab.attackReach, z: aimXZ.z };
      const errScale = plan.isSetter ? (quality === 'A' ? 1 : (quality === 'B' ? 1.25 : 1.6)) : 2.0;
      const to = scatter(aim, p.ab.tossError * errScale);
      const toL = L(T, to.x, to.z), aimL = L(T, aim.x, aim.z);
      if (toL.d < aimL.d) { // ネット側へのずれは小さめ
        const w = W(T, toL.lx, aimL.d - (aimL.d - toL.d) * PASS_NET_SIDE_ERROR);
        to.x = w.x; to.z = w.z;
      }
      const tempo = key === 'quick' && T.quickPlan ? Math.max(0.3, T.quickPlan.contactT - at) : opt.tempo;
      launch('set', T.side, hit, to, tempo, { touchNo: 2, attacker: attacker, attackKey: key, setDev: hypot2(to, aim) }, at);
    }

    // 3本目(スパイク)の準備: 打つ選手の助走、相手のブロックと守備、自チームのカバー
    function planAttack(T, f, at) {
      const atk = f.attacker;
      const tHit = timeToHeight(f, atk.ab.attackReach);
      const hitT = at + (tHit != null ? tHit : f.landT - 0.05);
      const hitP = posAt(f, hitT - at);
      if (f.attackKey !== 'quick') approach(atk, null, hitT, at, hitP);
      else { atk.goal = { x: hitP.x, z: hitP.z + T.s * 0.2 }; atk.moveSpeed = atk.ab.speed; }
      // 打つコース:操作中のチームはジョイスティックの狙い、CPU はトスが上がった時に決める。
      // 打つ選手はトスから打つまで、そのコースの方を向く(相手はそれを見てブロック・守備の位置を決められる)
      if (T.side === control) {
        aiming = true; aimDeadline = hitT;
        atk.intent = null;
      } else {
        atk.intent = cpuAttackAim(T, teams[other(T.side)], { x: hitP.x, y: hitP.y, z: hitP.z }, false);
      }
      atk.facing = { aim: atk.intent ? atk.intent.aim : null, until: hitT + FACE_AFTER_HIT };
      schedule(hitT, aAt => {
        aiming = false;
        const ball = posAt(f, aAt - f.t0);
        // トスが大きくずれて届かなければ打てない(チャンスボールで返す)
        const reachable = hypot2(atk, ball) < 1.4 && f.setDev < FREE_BALL_SET_ERROR;
        atk.x = ball.x; atk.z = ball.z;
        attackBy(T, atk, ball, aAt, reachable ? 'spike' : 'free', f.setDev);
      });
      // 相手のブロック・守備
      setDefense(teams[other(T.side)], hitP, hitT, at, f.attackKey);
      // 自チームのカバー
      coverAttack(T, atk, hitP, at);
    }

    function setDefense(D, attackP, hitT, at, attackKey) {
      const a = L(D, attackP.x, attackP.z).lx;
      const side = a > 1.2 ? 1 : (a < -1.2 ? -1 : 0);
      const mb = bySlot(D, 'FM');
      const wing = side > 0 ? bySlot(D, 'FR') : (side < 0 ? bySlot(D, 'FL') : null);
      const offWing = side > 0 ? bySlot(D, 'FL') : (side < 0 ? bySlot(D, 'FR') : null);
      const lim = HALF_W - 0.3;
      const jumpAt = hitT - BLOCK_UP;
      const blockAt = (p, lx, moveAt) => {
        const pos = W(D, clamp(lx, -lim, lim), BLOCK_NET_D);
        schedule(moveAt || at + REACTION, () => moveTo(p, pos, 0.9));
        schedule(jumpAt, jAt => { if (!airborne(p, jAt)) startJump(p, jAt, BLOCK_UP, p.ab.jumpHeight * 0.8, 'block'); });
      };
      // 打つ選手の向き(狙い)を読んで寄るための計画(readAttack で毎フレーム使う)
      const plan = { from: { x: attackP.x, z: attackP.z }, startAt: at + REACTION, hitT: hitT, blockers: [], spots: [] };
      D.readPlan = plan;
      if (wing) { blockAt(wing, a + side * 0.2); plan.blockers.push({ p: wing, lx: a + side * 0.2 }); }
      if (mb) {
        if (D.side === control) {
          blockControl = true;
          blockDeadline = jumpAt;
          schedule(jumpAt, jAt => {
            blockControl = false;
            if (!airborne(mb, jAt)) startJump(mb, jAt, BLOCK_UP, mb.ab.jumpHeight * 0.8, 'block');
          });
        } else if (D.mbCommit && attackKey !== 'quick') {
          // クイックにつられて跳んだMBは、着地してから遅れて寄る(読みで寄るのも着地してから)
          blockAt(mb, side ? a - side * 0.55 : a, Math.max(at + REACTION, D.mbCommit.landAt));
          plan.blockers.push({ p: mb, lx: side ? a - side * 0.55 : a, from: D.mbCommit.landAt });
        } else {
          blockAt(mb, side ? a - side * 0.55 : a);
          plan.blockers.push({ p: mb, lx: side ? a - side * 0.55 : a });
        }
      }
      D.mbCommit = null;
      // フェイント・インナーのカバー(ブロックに跳ばない前衛)
      const dropped = side ? [offWing] : [bySlot(D, 'FL'), bySlot(D, 'FR')];
      dropped.forEach(p => {
        if (!p) return;
        const lx = side ? -side * 1.6 : (p.slot === 'FL' ? -2.2 : 2.2);
        schedule(at + REACTION, () => moveLocal(p, { lx: lx, d: 3.2 }));
        plan.spots.push({ p: p, spot: Wp(D, { lx: lx, d: 3.2 }) });
      });
      // 後衛: ストレート・クロス・後ろ
      const spots = side
        ? { line: { lx: side * 3.6, d: 5.0 }, cross: { lx: -side * 3.4, d: 5.8 }, deep: { lx: -side * 0.9, d: 8.0 } }
        : { line: { lx: 3.2, d: 6.0 }, cross: { lx: -3.2, d: 6.0 }, deep: { lx: 0, d: 8.0 } };
      const lineSlot = side >= 0 ? 'BR' : 'BL';
      const crossSlot = side >= 0 ? 'BL' : 'BR';
      [[lineSlot, spots.line], [crossSlot, spots.cross], ['BM', spots.deep]].forEach(([slot, spot]) => {
        const p = bySlot(D, slot);
        if (p) {
          schedule(at + REACTION, () => moveLocal(p, spot));
          plan.spots.push({ p: p, spot: Wp(D, spot) });
        }
      });
    }

    // 打つ選手の向き(狙い)を読んで、ブロック・守備が寄る。トスが上がってから打つまで毎フレーム。
    //   - ブロック:CPU のチームだけ(操作中のチームのMBはプレイヤーが動かす)。狙いのコースがネットを通る位置へ BLOCK_READ だけ寄る
    //   - 守備:狙いに一番近い選手が、狙いへ DIG_READ だけ寄る(最大 DIG_READ_MAX m)
    function readAttack() {
      ['near', 'far'].forEach(side => {
        const D = teams[side];
        const rp = D.readPlan;
        if (!rp) return;
        if (time > rp.hitT) { D.readPlan = null; return; }
        if (time < rp.startAt) return;
        const A = teams[other(side)];
        const atk = A.onCourt.find(p => p.facing && p.facing.until > time);
        const aim = atk ? (atk.facing.aim || (A.side === control ? target : null)) : null;
        if (!aim) return;
        if (side !== control && rp.from.z * (rp.from.z - aim.z) > 0) {
          const t = rp.from.z / (rp.from.z - aim.z);
          const laneLx = L(D, rp.from.x + (aim.x - rp.from.x) * t, 0).lx;
          const shift = (laneLx - L(D, rp.from.x, 0).lx) * BLOCK_READ;
          const lim = HALF_W - 0.3;
          rp.blockers.forEach(b => {
            if (airborne(b.p, time) || (b.from && time < b.from)) return;
            moveTo(b.p, W(D, clamp(b.lx + shift, -lim, lim), BLOCK_NET_D), 0.9);
          });
        }
        let near = null;
        rp.spots.forEach(s => { if (!near || hypot2(s.spot, aim) < hypot2(near.spot, aim)) near = s; });
        rp.spots.forEach(s => {
          if (airborne(s.p, time)) return;
          if (s !== near) { moveTo(s.p, s.spot); return; }
          const dx = aim.x - s.spot.x, dz = aim.z - s.spot.z;
          const len = Math.hypot(dx, dz);
          const k = len > 0 ? Math.min(DIG_READ * len, DIG_READ_MAX) / len : 0;
          moveTo(s.p, { x: s.spot.x + dx * k, z: s.spot.z + dz * k });
        });
      });
    }

    // 自チームが打つ時、残りの選手は打つ選手の周り(ブロックに跳ね返されたボール)をカバーする
    function coverAttack(T, atk, hitP, at) {
      const c = L(T, hitP.x, hitP.z);
      const spots = [
        { lx: c.lx - 1.4, d: c.d + 1.6 }, { lx: c.lx + 1.4, d: c.d + 1.6 },
        { lx: c.lx * 0.5, d: c.d + 3.4 }, { lx: c.lx * 0.5 - 2.2, d: 6.2 }, { lx: c.lx * 0.5 + 2.2, d: 6.2 }
      ].map(s => ({ lx: clamp(s.lx, -HALF_W + 0.3, HALF_W - 0.3), d: clamp(s.d, 1.5, HALF_L - 0.5) }));
      const free = T.onCourt.filter(p => p !== atk && p !== T.lastToucher && !(T.quickPlan && T.quickPlan.p === p));
      free.forEach(p => {
        let best = 0, bestD = Infinity;
        spots.forEach((s, i) => {
          if (!s) return;
          const dd = hypot2(p, Wp(T, s));
          if (dd < bestD) { bestD = dd; best = i; }
        });
        const s = spots[best];
        spots[best] = null;
        if (s) schedule(at + 0.3, () => moveLocal(p, s));
      });
      // トスを上げた選手もカバーへ寄る
      if (T.lastToucher && T.lastToucher !== atk) {
        const sp = T.lastToucher;
        schedule(at + 0.3, () => moveLocal(sp, { lx: clamp(c.lx * 0.6, -3, 3), d: 2.2 }, JOG));
      }
    }

    // 3本目: 打つ。kind: 'spike' | 'tip' | 'free'
    function attackBy(T, atk, hit, at, kind, setDev) {
      T.touches = 3;
      T.lastToucher = atk;
      const O = teams[other(T.side)];
      const from = { x: hit.x, y: hit.y, z: hit.z };
      if (kind === 'free') {
        act(atk, airborne(atk, at) ? 'tip' : 'pass', at);
        emit('attack', { side: T.side, kind: 'free' });
        const to = W(O, (Math.random() * 2 - 1) * 2.5, 4 + Math.random() * 3.5);
        launchOver('free', T.side, from, { x: to.x, y: R, z: to.z }, 1.5, 0.6, { touchNo: 3 }, at);
        return;
      }
      let aim, tip = kind === 'tip';
      if (T.side === control) {
        aim = { x: target.x, y: R, z: target.z };
        if (L(O, aim.x, aim.z).d < TIP_DEPTH) tip = true;
      } else {
        // トスの時に決めたコースで打つ。そのコースがブロックで塞がれていたら、CPU_LATE_ADJUST の確率で打つ瞬間に変える
        const intent = atk.intent;
        if (intent && !(tip && !intent.tip)) {
          aim = intent.aim; tip = intent.tip;
          if (!tip && courseBlocked(O, from, aim) && Math.random() < CPU_LATE_ADJUST) {
            const r = cpuAttackAim(T, O, from, false);
            aim = r.aim; tip = r.tip;
            atk.facing = { aim: aim, until: at + FACE_AFTER_HIT };
          }
        } else {
          const r = cpuAttackAim(T, O, from, tip);
          aim = r.aim; tip = r.tip;
        }
      }
      atk.intent = null;
      if (T.side === control) atk.facing = { aim: { x: aim.x, z: aim.z }, until: at + FACE_AFTER_HIT };
      emit('attack', { side: T.side, kind: tip ? 'tip' : 'spike' });
      act(atk, tip ? 'tip' : 'spike', at);
      if (tip) {
        launchOver('tip', T.side, from, scatter(aim, 0.35), 0.9, 0.3, { touchNo: 3 }, at);
        return;
      }
      const sigma = atk.ab.spikeError + (setDev || 0) * SET_ERROR_TO_SPIKE;
      // 狙った所へ白帯の上を通る速さで打つ(近くを狙うほど遅く山なりになる)
      const g = G + TOPSPIN_SPIKE;
      let T_ = Math.max(0.12, hypot2(from, aim) / atk.ab.spikeSpeed);
      for (let i = 0; i < 40 && netClearance(from, aim, T_, g) < SPIKE_NET_MARGIN; i++) T_ += 0.03;
      const to = scatter(aim, sigma);
      const v = ballistic(from, to, T_, g);
      v.y += gaussian() * SPIKE_HEIGHT_ERROR * atk.ab.spikeError;
      startFlight({ kind: 'attack', side: T.side, p0: from, v: v, g: g, touchNo: 3, attacker: atk }, at);
    }

    // 白帯の上を margin 以上あけて越える山なりで打つ(フェイント・チャンスボール)
    function launchOver(kind, side, from, to, T, margin, extra, at) {
      let T_ = T;
      for (let i = 0; i < 40 && netClearance(from, to, T_) < margin; i++) T_ += 0.05;
      return launch(kind, side, from, to, T_, extra, at);
    }

    // from から to へ T 秒で打った時、ネットの上を白帯から何m上で通るか
    function netClearance(from, to, T, g) {
      const gg = g || G;
      const v = ballistic(from, to, T, gg);
      if (Math.abs(v.z) < 1e-6) return Infinity;
      const tc = -from.z / v.z;
      if (tc <= 0 || tc >= T) return Infinity;
      return from.y + v.y * tc - 0.5 * gg * tc * tc - NET_CLEAR;
    }

    // ブロックに跳ぶ(跳びそうな)選手と、from から c へのコースがその手の範囲を通るか
    function blockersOf(O) {
      return O.onCourt.filter(p => Math.abs(p.z) < 1.2 && (airborne(p, time) || (p.goal && Math.abs(p.goal.z) < 1.0)));
    }
    function courseBlocked(O, from, c, blockers) {
      const bs = blockers || blockersOf(O);
      if (!bs.length) return false;
      const spanX = p => (p.goal && Math.abs(p.goal.z) < 1.0 ? p.goal.x : p.x);
      const t = from.z / (from.z - c.z);
      const xAt = from.x + (c.x - from.x) * t;
      return bs.some(b => Math.abs(xAt - spanX(b)) <= b.ab.blockReach);
    }

    // CPU のスパイクの狙い。ブロックで塞がれていないコースのうち、守備から一番遠い所(守備の隙)を狙う。
    function cpuAttackAim(T, O, from, forceTip) {
      const blockers = blockersOf(O);
      const defenders = O.onCourt.filter(p => !blockers.includes(p));
      const blocked = c => courseBlocked(O, from, c, blockers);
      const gapOf = c => {
        let g = Infinity;
        defenders.forEach(p => { g = Math.min(g, hypot2(c, p.goal || p)); });
        return g;
      };
      const tip = forceTip || Math.random() < CPU_TIP_RATE + (blockers.length >= 2 ? 0.06 : 0);
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < CPU_AIM_CANDIDATES; i++) {
        const lx = (Math.random() * 2 - 1) * (HALF_W - CPU_AIM_MARGIN);
        const dd = tip ? 1.2 + Math.random() * 1.8 : 2.0 + Math.random() * (HALF_L - 2.0 - CPU_AIM_MARGIN);
        const w = W(O, lx, dd);
        const c = { x: w.x, y: R, z: w.z };
        let score = gapOf(c);
        if (!tip && blocked(c)) score -= 1000;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return { aim: best, tip: tip };
    }

    // 3本目が自コートに残った等の予備(近くの選手がチャンスボールで返す)
    function planEmergency(T, f, at) {
      const c = contactPoint(f, PASS_H, T);
      const r = chooseRunner(T.onCourt.filter(p => p !== T.lastToucher), c.p, c.t, TEAM_REACTION, at);
      if (!r) return;
      schedule(at + TEAM_REACTION, () => moveTo(r.p, c.p));
      if (!r.ok) return;
      act(r.p, 'pass', at + c.t);
      schedule(at + c.t, cAt => {
        const hit = posAt(f, cAt - f.t0);
        attackBy(T, r.p, hit, cAt, 'free', 0);
      });
    }

    // ---------- ブロック ----------
    function checkBlock(at) {
      const f = flight;
      const c = f.cross;
      const D = teams[other(f.side)];
      const blockers = D.onCourt.filter(p => airborne(p, at) && jumpY(p, at) > p.jump.h * 0.5 && Math.abs(p.z) < 1.0 &&
        Math.abs(c.x - p.x) <= p.ab.blockReach);
      if (!blockers.length) return;
      let b = blockers[0];
      blockers.forEach(q => { if (Math.abs(c.x - q.x) < Math.abs(c.x - b.x)) b = q; });
      const top = Math.max.apply(null, blockers.map(q => q.ab.blockTop + (jumpY(q, at) - q.jump.h)));
      if (c.y > top + BLOCK_OVER_MARGIN) return; // ブロックの上を抜けた
      const atk = f.attacker;
      const diff = b.ab.blockPower - (atk ? atk.ab.attackPower : 50);
      if (Math.random() >= clamp(BLOCK_TOUCH_BASE + diff * 0.01 + (blockers.length - 1) * 0.1, 0.3, 0.92)) return;
      const pStuff = clamp(BLOCK_STUFF_BASE + diff * 0.01, 0.1, 0.6);
      const pOut = clamp(BLOCK_OUT_BASE - diff * 0.005, 0.05, 0.3);
      const r = Math.random();
      const A = teams[f.side];
      const from = { x: c.x, y: Math.max(c.y, NET_CLEAR + 0.05), z: D.s * 0.02 };
      D.lastToucher = b;
      emit('block', { side: D.side, result: r < pStuff ? 'stuff' : (r < pStuff + pOut ? 'out' : 'touch') });
      if (r < pStuff) {
        // シャット: 攻撃側のネット際へ叩き落とす(3割は弱く跳ね返ってカバーで拾えることがある)
        const soft = Math.random() < 0.3;
        const to = W(A, clamp(L(A, c.x, 0).lx + (Math.random() * 2 - 1), -HALF_W + 0.3, HALF_W - 0.3), soft ? 1.5 + Math.random() * 2 : 0.4 + Math.random() * 1.4);
        launch('blockStuff', D.side, from, { x: to.x, y: R, z: to.z }, soft ? 0.9 : 0.4, { isBlock: true, touchNo: 0 }, at);
      } else if (r < pStuff + pOut) {
        const sx = Math.sign(c.x) || (Math.random() < 0.5 ? -1 : 1);
        const to = { x: sx * (HALF_W + 0.8 + Math.random() * 1.5), y: R, z: D.s * (1 + Math.random() * 6) };
        launch('blockOut', D.side, { x: c.x, y: c.y, z: D.s * 0.15 }, to, 0.9, { isBlock: true, touchNo: 0 }, at);
      } else {
        // ワンタッチ: ブロック側のコートへ山なりに弾く(ブロック側の1本目として拾う)
        const to = W(D, clamp(L(D, c.x, 0).lx * 0.5 + (Math.random() * 2 - 1) * 1.5, -HALF_W + 0.5, HALF_W - 0.5), 2 + Math.random() * 4.5);
        launch('blockTouch', D.side, { x: c.x, y: c.y, z: D.s * 0.15 }, { x: to.x, y: R, z: to.z }, 1.4, { isBlock: true, touchNo: 0 }, at);
        toDefenseBase(A);
      }
    }

    // ---------- サーブ ----------
    function canServe() { return phase === 'preServe' && servingSide === control; }

    function serve() {
      if (!canServe()) return;
      beginServe(time, { x: target.x, y: R, z: target.z });
    }

    function cpuServe(at) {
      if (phase !== 'preServe') return;
      const O = teams[other(servingSide)];
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 5; i++) {
        const w = W(O, (Math.random() * 2 - 1) * 3.8, 3.0 + Math.random() * 5.7);
        let g = Infinity;
        O.onCourt.forEach(p => { g = Math.min(g, hypot2(w, p)); });
        if (g > bestScore) { bestScore = g; best = w; }
      }
      beginServe(at, { x: best.x, y: R, z: best.z });
    }

    function beginServe(at, aim) {
      const T = teams[servingSide];
      const sv = serverOf(T);
      phase = 'serving';
      rallyToken++;
      // トスを上げる(ジャンプサーブは助走して跳ぶ)
      const hand = { x: sv.x, y: HAND_H, z: sv.z - T.s * 0.3 };
      const contactH = sv.ab.jumpServe ? sv.ab.attackReach - 0.15 : FLOAT_SERVE_H;
      const contactZ = sv.ab.jumpServe ? sv.z - T.s * 1.2 : sv.z - T.s * 0.3;
      const contact = { x: sv.x, y: contactH, z: contactZ };
      launch('serveToss', T.side, hand, contact, SERVE_TOSS_TIME, {}, at);
      act(sv, sv.ab.jumpServe ? 'jumpServe' : 'floatServe', at + SERVE_TOSS_TIME);
      if (sv.ab.jumpServe) {
        moveTo(sv, { x: sv.x, z: contactZ + T.s * 0.2 }, 0.6);
        schedule(at + SERVE_TOSS_TIME - JUMP_UP, jAt => startJump(sv, jAt, JUMP_UP, sv.ab.jumpHeight * 0.85));
      }
      schedule(at + SERVE_TOSS_TIME, cAt => serveContact(T, sv, contact, aim, cAt));
    }

    function serveContact(T, sv, from, aim, at) {
      phase = 'rally';
      T.touches = 3;
      T.lastToucher = sv;
      const to = scatter(aim, sv.ab.serveError);
      const dist = hypot2(from, to);
      const g = sv.ab.jumpServe ? G + TOPSPIN_JUMP_SERVE : G;
      let T_ = dist / sv.ab.serveSpeed;
      // ネットを越えるまで山なりにする(狙った所へ入れる打ち方)
      for (let i = 0; i < 60 && netClearance(from, to, T_, g) < 0.25; i++) T_ += 0.04;
      const v = ballistic(from, to, T_, g);
      v.y += gaussian() * 0.35 * sv.ab.serveError; // 打ち出しの高さのブレ(ネット・オーバーの原因)
      const speed = Math.hypot(v.x, v.z);
      const f = {
        kind: 'serve', side: T.side, p0: from, v: v, g: g, touchNo: 3,
        wobble: !sv.ab.jumpServe,
        serveFactor: sv.ab.jumpServe ? 1.5 + Math.max(0, speed - 18) * 0.08 : 1.5 + Math.max(0, speed - 14) * 0.06
      };
      emit('serve', { side: T.side, jump: sv.ab.jumpServe });
      startFlight(f, at);
      // サーブを打ったらサーバーはコートへ入り、全員が専門の位置へ移る
      schedule(at + 0.3, () => toDefenseBase(T));
    }

    // ---------- ラリーの終わり・得点 ----------
    function endRally(winner, reason, at, kind) {
      if (phase !== 'rally' && phase !== 'serving') return;
      phase = 'dead';
      rallyCount++;
      lastRally = { winner: winner, reason: reason };
      emit('rally', { winner: winner, reason: reason, serving: servingSide, kind: kind });
      setChoice = null;
      aiming = false;
      blockControl = false;
      teams.near.readPlan = null;
      teams.far.readPlan = null;
      rallyToken++;
      clearPlannedActions(at, true);
      schedule(at + DEAD_HOLD, aAt => awardPoint(winner, aAt), 'match');
    }

    function awardPoint(winner, at) {
      const Wt = teams[winner];
      const Lt = teams[other(winner)];
      Wt.points++;
      allPlayers.forEach(p => recover(p, p.onCourt ? RECOVER_POINT : RECOVER_BENCH));
      if (servingSide !== winner) { // サイドアウト: ローテーションしてサーブ権を取る
        Wt.rot++;
        servingSide = winner;
      }
      const finalSet = setNumber === rules.setsToWin * 2 - 1;
      const need = finalSet ? rules.finalSetPoints : rules.setPoints;
      scoreVersion++;
      if (Wt.points >= need && Wt.points - Lt.points >= 2) {
        Wt.sets++;
        setResults.push({ near: teams.near.points, far: teams.far.points });
        if (Wt.sets >= rules.setsToWin) {
          matchWinner = winner;
          phase = 'matchOver';
          return;
        }
        phase = 'setBreak';
        schedule(at + SET_BREAK, nAt => {
          setNumber++;
          teams.near.points = 0; teams.far.points = 0;
          teams.near.rot = 0; teams.far.rot = 0;
          allPlayers.forEach(p => recover(p, RECOVER_SET_BREAK));
          firstServeOfSet = other(firstServeOfSet); // セットごとに最初のサーブを交代
          servingSide = firstServeOfSet;
          scoreVersion++;
          preparePoint(nAt);
        }, 'match');
        return;
      }
      preparePoint(at);
    }

    // 次のサーブの準備: リベロの交代、サーブ前の陣形へ歩く
    function preparePoint(at) {
      phase = 'between';
      flight = null;
      ballDead = null;
      rallyToken++;
      allPlayers.forEach(applyFatigue);
      arrangeTeam(teams.near);
      arrangeTeam(teams.far);
      formation(teams[servingSide], true);
      formation(teams[other(servingSide)], false);
      schedule(at + BETWEEN_POINTS, rAt => {
        phase = 'preServe';
        if (servingSide !== control) schedule(rAt + CPU_SERVE_DELAY, cpuServe, 'match');
      }, 'match');
    }

    function formation(T, serving) {
      const bench = T.members.filter(p => !p.onCourt);
      bench.forEach((p, i) => moveTo(p, W(T, -(HALF_W + 1.3), 3.5 + i * 0.9), JOG));
      if (serving) {
        T.onCourt.forEach(p => {
          moveLocal(p, p.zone === 1 ? SERVE_SPOT : ZONE_SPOT[p.zone], JOG);
        });
        return;
      }
      // サーブレシーブ: 前衛OH・リベロ(か後衛MB)・後衛OHの3人で受ける。他は邪魔にならない所へ。
      const recv = { FL: { lx: -2.9, d: 5.6 }, BL: { lx: 0, d: 6.4 }, BM: { lx: 2.9, d: 5.8 } };
      T.onCourt.forEach(p => {
        let spot;
        if (recv[p.slot]) spot = recv[p.slot];
        else if (p.role === 'S' && !isFrontZone(p.zone)) spot = { lx: 2.4, d: 3.0 }; // 後衛セッターは前へ隠れてすぐ返球先へ
        else if (isFrontZone(p.zone)) spot = { lx: ZONE_SPOT[p.zone].lx, d: 1.0 };
        else spot = { lx: ZONE_SPOT[p.zone].lx, d: 8.6 };
        moveLocal(p, spot, JOG);
      });
    }

    // ---------- 毎フレーム更新 ----------
    // joystickValue: {x, y} 各 -1〜1
    // inputDt: 狙いのマーカーを動かす時間(実時間)。スロー表示中も狙いは普段の速さで動かせるように、
    //          試合の時間(dt)とは別に渡せる。省略時は dt。
    function update(dt, joystickValue, inputDt) {
      const joy = joystickValue || { x: 0, y: 0 };
      time += dt;
      processEvents();
      handleControls(dt, joy, inputDt == null ? dt : inputDt);
      readAttack();
      updatePlayers(dt);
      if (flight) {
        ballSpin.x += dt * 9;
        ballSpin.z += dt * 6;
      }
    }

    function handleControls(dt, joy, inputDt) {
      if (!control) return;
      const T = teams[control];
      if (setChoice) {
        // レフト/ライトへ倒すとその方向、上下に倒すとセンター(倒して離しても選択は残る)
        const zone = joy.x <= -1 / 3 ? 'left' : (joy.x >= 1 / 3 ? 'right' : (Math.abs(joy.y) > 0.5 ? 'center' : null));
        if (zone && setChoice.zones[zone].enabled) setChoice.zone = zone;
      }
      if (canServe() || aiming) {
        const O = teams[other(control)];
        const sq = discToSquare(joy.x, joy.y);
        target.x += sq.x * T.s * 4 * inputDt;
        target.z += -sq.y * T.s * 4 * inputDt; // 上に倒すと奥へ
        const loc = L(O, target.x, target.z);
        const w = W(O, clamp(loc.lx, -(HALF_W + 1), HALF_W + 1), clamp(loc.d, 0.3, HALF_L + 1));
        target.x = w.x; target.z = w.z;
      }
      if (blockControl) {
        const mb = bySlot(T, 'FM');
        if (mb && !airborne(mb, time)) {
          mb.goal = null;
          const lim = HALF_W - 0.3;
          mb.x = clamp(mb.x + joy.x * T.s * BLOCK_CONTROL_SPEED * dt, -lim, lim);
          const dz = T.s * BLOCK_NET_D - mb.z;
          mb.z += clamp(dz, -mb.ab.speed * dt, mb.ab.speed * dt);
        }
      }
    }

    function ballPos() {
      if (flight) {
        const t = time - flight.t0;
        const end = flight.kind === 'serveToss' ? Infinity : (flight.netT != null ? flight.netT : flight.landT);
        const p = posAt(flight, Math.min(t, end));
        if (flight.wobble && flight.landT) { // フローターサーブの揺れ(見た目だけ。始点と着地点は変えない)
          const u = clamp(t / flight.landT, 0, 1);
          p.x += 0.18 * Math.sin(Math.PI * u) * Math.sin(5 * Math.PI * u);
        }
        return p;
      }
      if (ballDead) return ballDead;
      const sv = serverOf(teams[servingSide]);
      const T = teams[servingSide];
      return sv ? { x: sv.x, y: HAND_H, z: sv.z - T.s * 0.3 } : { x: 0, y: HAND_H, z: 0 };
    }

    function controlWindow() {
      if (setChoice) return { kind: 'set', deadline: setChoice.deadline };
      if (aiming) return { kind: 'aim', deadline: aimDeadline };
      if (blockControl) return { kind: 'block', deadline: blockDeadline };
      return null;
    }

    function getState() {
      const ball = ballPos();
      const scoreOf = T => ({ points: T.points, sets: T.sets });
      return {
        time: time,
        target: { x: target.x, z: target.z },
        targetVisible: canServe() || aiming,
        ball: { x: ball.x, y: ball.y, z: ball.z, rotX: ballSpin.x, rotZ: ballSpin.z },
        // サーブを打つ選手(サーブ待ち・トス中だけ)
        players: (server => allPlayers.map(p => {
          // コート内の選手はボールの方を向く(ベンチの選手はコートの方)
          const tx = p.onCourt ? ball.x : 0;
          const tz = p.onCourt ? ball.z : p.z;
          let yaw = Math.atan2(tx - p.x, tz - p.z);
          if (!p.onCourt) yaw = Math.atan2(-p.x, 0);
          // スパイクを打つ選手は、トスから打った直後まで打つコースの方を向く(操作中のチームは今の狙い)
          if (p.onCourt && p.facing && time < p.facing.until) {
            const aim = p.facing.aim || (p.side === control ? target : null);
            if (aim) yaw = Math.atan2(aim.x - p.x, aim.z - p.z);
          }
          // action: 見た目の動作。t は触る(跳ぶ動作は最高点の)時刻からの経過秒(触る前は負)
          const a = p.action && time - p.action.at < ACTION_HOLD ? { kind: p.action.kind, t: time - p.action.at } : null;
          return {
            id: p.id, x: p.x, y: p.y, z: p.z, yaw: yaw, onCourt: p.onCourt, role: p.role, slot: p.slot, fatigue: p.fatigue,
            action: a, server: p === server
          };
        }))(phase === 'preServe' || phase === 'serving' ? serverOf(teams[servingSide]) : null),
        canServe: canServe(),
        setChoice: setChoice ? {
          zones: {
            left: { label: setChoice.zones.left.label, enabled: setChoice.zones.left.enabled },
            center: { label: setChoice.zones.center.label, enabled: setChoice.zones.center.enabled },
            right: { label: setChoice.zones.right.label, enabled: setChoice.zones.right.enabled }
          },
          active: setChoice.zone,
          // 今選んでいるトスを打つ選手の id(頭の上に▼を出す)
          targetId: (k => (k && setChoice.options[k] ? setChoice.options[k].p.id : null))(setChoice.zones[setChoice.zone].key),
          quality: setChoice.quality
        } : null,
        blockControl: blockControl,
        // 時間に追われる操作(トス方向・スパイクの狙い・ブロック)の種類と締め切り(試合の時刻)。無ければ null
        control: controlWindow(),
        phase: phase,
        servingSide: servingSide,
        setNumber: setNumber,
        setResults: setResults.slice(),
        score: { near: scoreOf(teams.near), far: scoreOf(teams.far) },
        scoreVersion: scoreVersion,
        rallyCount: rallyCount,
        lastRally: lastRally,
        matchWinner: matchWinner
      };
    }

    // 最初のサーブの準備(最初から陣形の位置に立たせておく)
    preparePoint(0);
    allPlayers.forEach(p => { if (p.goal) { p.x = p.goal.x; p.z = p.goal.z; p.goal = null; } });

    return {
      update: update,
      serve: serve,
      canServe: canServe,
      getState: getState
    };
  }

  global.VolleyballSimulation = Object.freeze({
    create: create,
    ROLE_ORDER: ROLE_ORDER
  });
})(window);
