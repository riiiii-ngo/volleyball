/**
 * VolleyballSimulation
 * 試合の状態(ボールの飛行、狙い位置、アタッカー/ブロッカーのフェーズ)を
 * 管理する純粋なロジック層。THREE.js のシーングラフやDOMには一切触れない。
 *
 * 将来オンライン対戦にする場合は、この層が「権威のある状態」を持つ側
 * (サーバー or ホスト)になり、getState() のスナップショットを相手に送る、
 * applyCommand() で受け取った操作を反映する、という使い方を想定している。
 * チーム編成機能を作る場合も、選手の役割(サーバー/セッター/アタッカー等)を
 * ここに渡す config を差し替えるだけで対応できるようにしてある。
 */
(function (global) {
  'use strict';

  const GRAVITY = 9.8;

  const TOSS_HEIGHT = 2.3;
  const SETTER_HEIGHT = 2.2;
  const TOSS_TARGET_HEIGHT = 3.0;

  const SERVE_ARC_HEIGHT = 4.0;
  const SERVE_TIME = 2.6;
  const TOSS_ARC_HEIGHT = 2.0;
  const TOSS_TIME = 2.0;
  const SPIKE_ARC_HEIGHT = 1.4;
  const SPIKE_TIME = 0.85;
  const LANDED_HOLD = 0.8;

  const APPROACH_DIST = 0.6;
  const JUMP_HEIGHT = 0.55;
  const JUMP_DURATION_ATTACK = 0.55;
  const LAND_DURATION = 0.45;

  const BLOCK_JUMP_HEIGHT = 0.5;
  const JUMP_DURATION_BLOCK = 0.35;
  const BLOCK_RETURN_DURATION = 0.7;

  const WING_BLOCK_MOVE_TIME = 0.8;  // サイドの前衛がブロック位置へ寄るのにかける時間(秒)
  const COVER_MOVE_TIME = 0.8;       // 反対サイドの前衛がフェイント/インナーのカバー位置へ下がる時間(秒)
  const COVER_DEPTH = 3.0;           // カバー位置のネットからの距離(m)。アタックライン付近
  const COVER_X_RATIO = 0.6;         // カバー位置の横位置(定位置の x に対する割合。内側へ寄る)
  const DEFAULT_BLOCK_REACH = 0.55;  // ブロックで塞げる幅(ブロッカーの中心から左右それぞれ, m)の既定値
  const DEFAULT_BLOCK_POWER = 50;    // ブロックの当たり判定で使うブロック値/パワー値の既定値
  // ブロックの当たり判定(コースがブロックの範囲を通った時)。diff = ブロッカーのブロック値 − 攻撃者のパワー値。
  //   当たる確率      = clamp(0.6  + diff*0.01 , 0.3 , 0.9)   当たらなければそのまま通過
  //   当たった時: シャット(相手コートへ叩き落とす)= clamp(0.35 + diff*0.01 , 0.1 , 0.6)
  //              ブロックアウト(手に当たって外へ) = clamp(0.15 - diff*0.005, 0.05, 0.3)
  //              残りはワンタッチ(上に弾いて自陣へ。そのまま拾ってラリー続行)
  const BLOCK_TOUCH_BASE = 0.6;
  const BLOCK_STUFF_BASE = 0.35;
  const BLOCK_OUT_BASE = 0.15;
  const BLOCK_CONTROL_SPEED = 3.5; // 自分側ブロッカーをジョイスティックで操作する速度(m/秒)
  const BLOCK_SIDE_MARGIN = 0.3; // ブロック操作できる範囲をコート端からこれだけ内側に制限

  const DEFAULT_PLAYER_SPEED = 4.4; // 選手ごとの speed パラメータを省略した場合の既定値(m/秒)
  const RECEIVE_MOVE_MIN = 0.25;
  const RECEIVE_RETURN_MIN = 0.3;
  const RECEIVE_RETURN_MAX = 1.6;
  const RECEIVE_ARC_HEIGHT = 2.2;   // レシーブ(返球)の山なりの高さ
  const RECEIVE_TIME = 1.6;         // レシーブがセッターへ届くまでの時間(=トス方向を選べる時間)
  const RECEIVE_TARGET_HEIGHT = 2.0;

  // レシーブ到達判定：落下の瞬間、レシーバーがこの距離以内まで寄れていれば(飛びついて)拾える。
  // 届かなければボールはそのまま落ちてラリー終了。
  const DIVE_REACH = 0.8;
  // 打たれてからレシーバーが動き出すまでの反応時間(秒)。これが無いと打った瞬間に最短で走り出せてしまい、
  // スパイク(約0.85秒で着地)でもほぼ全部拾えてしまう。
  const REACTION_TIME = 0.3;
  // 狙いのブレ(正規分布の標準偏差, m)の既定値。選手ごとの値は能力(VolleyballStats)から渡される。
  const DEFAULT_SPIKE_ERROR = 0.75;
  const DEFAULT_SERVE_ERROR = 0.7;
  const DEFAULT_PASS_ERROR = 0.85;
  const DEFAULT_TOSS_ERROR = 0.5;
  const MAX_ERROR_SIGMA = 2.5;       // ブレは標準偏差のこの倍数までで打ち切る(極端な外れ値を防ぐ)
  const TOSS_ERROR_TO_SPIKE = 0.5;   // トスがずれた距離のこの割合だけ、スパイクのブレが大きくなる
  const FAR_AIM_MARGIN = 0.3;        // 相手(CPU)はサイドライン・エンドラインからこれだけ内側を狙う
  const FAR_AIM_MIN_DEPTH = 1.5;     // 相手(CPU)はネットからこれ以上奥を狙う
  const FAR_AIM_CANDIDATES = 5;      // 相手(CPU)は狙いの候補をこの数だけ考え、こちらの選手から一番遠い所を選ぶ(大きいほど隙を突くのがうまい)

  const TOSS_ZONE_THRESHOLD = 1 / 3; // ジョイスティックx入力をレフト/センター/ライトの3等分ゾーンに分ける境界

  const SERVE_MARGIN = 1;
  const MARKER_SPEED = 4; // m/秒

  function vec(x, y, z) { return { x: x, y: y, z: z }; }

  // 円形のジョイスティック入力(半径最大1)を正方形の可動範囲いっぱいまで
  // 届くように引き伸ばす変換（対角=コートの隅にも到達できるようにする）
  function discToSquare(x, y) {
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const mag = Math.min(1, Math.hypot(x, y));
    const maxAbs = Math.max(Math.abs(x), Math.abs(y));
    const scale = mag / maxAbs;
    return { x: x * scale, y: y * scale };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // 標準正規分布の乱数(Box-Muller)
  function gaussian() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  // 狙った点(x,z)を、標準偏差 sigma(m) でランダムにずらす。y はそのまま。
  function scatter(p, sigma) {
    const dx = clamp(gaussian(), -MAX_ERROR_SIGMA, MAX_ERROR_SIGMA) * sigma;
    const dz = clamp(gaussian(), -MAX_ERROR_SIGMA, MAX_ERROR_SIGMA) * sigma;
    return { x: p.x + dx, y: p.y, z: p.z + dz };
  }

  function zoneFromJoystickX(x) {
    if (x <= -TOSS_ZONE_THRESHOLD) return 'left';
    if (x >= TOSS_ZONE_THRESHOLD) return 'right';
    return 'center';
  }

  /**
   * @param {Object} config
   * @param {Object} config.dimensions - VolleyballCourt.DIMENSIONS 相当
   * @param {number} config.ballRadius - VolleyballBall.RADIUS 相当
   * @param {{x:number,z:number}} config.serverPos - サーブを打つ位置(コート外)。サーバーは近チームの
   *        セッター(near-server)を兼任し、サーブを打った後は config.setterCourtPos へ入って守る。
   * @param {{x:number,z:number}} [config.setterCourtPos] - セッターのラリー中の守備位置(後衛ライト)。
   *        省略時はサーブ位置の x、後衛(nearReceivers[0])と同じ z。
   * @param {{x:number,z:number}} config.leftAttackerPos - レフト攻撃者(near-front-1)の位置
   * @param {{x:number,z:number}} config.centerAttackerPos - センター攻撃者(near-front-2)の位置。
   *        自チームブロッカー(ジョイスティック左右操作)とスロットを共有する。
   * @param {{x:number,z:number}} config.rightAttackerPos - ライト攻撃者(near-front-3)の位置
   * @param {{left?:Object, center?:Object, right?:Object}} [config.attackers] - 3攻撃者の能力
   *        { jumpHeight?, spikeTime? }。省略時は JUMP_HEIGHT / SPIKE_TIME。
   * @param {number} [config.serveTime] - サーブが着地するまでの時間(秒)。省略時は SERVE_TIME。
   * @param {Array<{name:string, pos:{x:number,z:number}, speed?:number, reach?:number}>} config.nearReceivers -
   *        自チームのレシーブ担当(near-back-1/2)。落下点に最も近い選手が自動でレシーブする。
   * @param {Array<{name:string, pos:{x:number,z:number}, speed?:number,
   *        reach?:number, jumpHeight?:number, spikeTime?:number}>} config.farPlayers -
   *        相手チーム6人の定義。こちらの攻撃に対しては、センター(far-front-2)と攻撃側の前衛
   *        (far-front-1 / far-front-3)が打点へ寄ってブロックに跳ぶ。
   *        レシーブは毎回、落下点に最も近い選手が自動で行う。
   *
   * 選手ごとの能力(キャラクターのステータスから VolleyballStats で変換した値):
   *   speed(m/秒)移動速度 / reach(m)飛びつける距離 / jumpHeight(m)スパイクのジャンプ高さ /
   *   spikeTime(秒)スパイクが着地するまでの時間。省略時は各定数の標準値。
   * 狙いの正確さ(ブレの標準偏差, m。小さいほど狙った所に行く):
   *   spikeError(スパイク) / passError(レシーブの返球) / tossError(トス)。
   *   config.serveError(サーブ)、config.setter = { tossError, speed?, reach?, passError? }(自チームのセッター)。
   *
   * 自チームのレシーブ: 後衛2人(nearReceivers)・セッター(コートに入った後)・前衛レフト/ライトのうち、
   * 落下点に最も近い選手が拾う(前衛センターはブロッカーを兼ねるので拾わない)。セッター自身が拾った時は、
   * 他の後衛のうちトスが一番うまい選手が代わりにトスを上げる。前衛の能力(speed/reach/passError)は
   * config.attackers の各要素で渡す。
   *
   * 自チームのブロック: 相手のトスが上がると、前衛センター(ジョイスティックで左右に操作)に加えて、
   * トスが上がった側の前衛(レフト/ライト)がその位置へ寄って一緒に跳ぶ。反対側の前衛はネットから
   * 下がってフェイント/インナーのカバーに入る(そこからレシーブに参加する)。
   * 相手は前衛レフト(far-front-1)・ライト(far-front-3)のどちらかにランダムにトスを上げる。
   *
   * ブロックの当たり判定: スパイクのコースがネット(z=0)を通る位置が、跳んでいるブロッカーの範囲
   * (blockReach)に入ると、ブロック値と攻撃者のパワー値で「通過/シャット/ワンタッチ/ブロックアウト」
   * が決まる(BLOCK_*_BASE)。選手ごとの blockPower / attackPower(1〜99)で渡す。
   *
   * ラリーの結果は getState() の rallyCount / lastRally({ winner:'near'|'far', reason:'in'|'out'|'net' }) で分かる。
   */
  function create(config) {
    const d = config.dimensions;
    const ballRadius = config.ballRadius;
    const frontZ = config.centerAttackerPos.z;

    const serveRange = {
      xMin: -(d.COURT_W / 2 + SERVE_MARGIN),
      xMax: d.COURT_W / 2 + SERVE_MARGIN,
      zNet: -0.3,
      zFar: -(d.COURT_L / 2 + SERVE_MARGIN)
    };

    const serveOrigin = vec(config.serverPos.x, TOSS_HEIGHT, config.serverPos.z - 0.4);

    function tossTargetFor(pos, sideSign) {
      return vec(pos.x + sideSign * 0.3, TOSS_TARGET_HEIGHT, pos.z + 0.2);
    }

    // 自チームの3攻撃者(レフト/センター/ライト)。トスの狙い先はそれぞれの定位置から少し手前・net寄り。
    const attackTargets = {
      left: tossTargetFor(config.leftAttackerPos, -1),
      center: tossTargetFor(config.centerAttackerPos, 0),
      right: tossTargetFor(config.rightAttackerPos, 1)
    };

    // レシーブの返球先(セッターが寄っていく固定の待機点)。
    const passTargetPoint = vec(1.0, RECEIVE_TARGET_HEIGHT, frontZ + 1.8);

    function makeAttacker(pos, ability) {
      const a = ability || {};
      return {
        baseX: pos.x, baseZ: pos.z,
        jumpHeight: a.jumpHeight || JUMP_HEIGHT,
        spikeTime: a.spikeTime || SPIKE_TIME,
        spikeError: a.spikeError || DEFAULT_SPIKE_ERROR,
        // 前衛レフト/ライトはネット際の短いボールをレシーブする
        speed: a.speed || DEFAULT_PLAYER_SPEED,
        reach: a.reach || DIVE_REACH,
        passError: a.passError || DEFAULT_PASS_ERROR,
        tossError: a.tossError || DEFAULT_TOSS_ERROR,
        blockReach: a.blockReach || DEFAULT_BLOCK_REACH,
        blockPower: a.blockPower || DEFAULT_BLOCK_POWER,
        attackPower: a.attackPower || DEFAULT_BLOCK_POWER,
        x: pos.x, y: 0, z: pos.z,
        activity: 'idle', // 'idle' | 'attack' | 'receive' | 'block'(サイドのブロック) | 'cover'(フェイントのカバー)
        phase: 'idle', // attack: 'approach' | 'landing' / receive: updateReceiver と同じ
        phaseStart: 0,
        attackFromX: pos.x, attackFromZ: pos.z, // 助走を始めた位置(レシーブ後の位置から助走に入れるように)
        approachFrom: null,
        approachTo: null,
        approachDuration: 0,
        returnFrom: null
      };
    }

    const attackerAbility = config.attackers || {};
    const leftAttacker = makeAttacker(config.leftAttackerPos, attackerAbility.left);
    const centerAttacker = makeAttacker(config.centerAttackerPos, attackerAbility.center);
    const rightAttacker = makeAttacker(config.rightAttackerPos, attackerAbility.right);
    let currentNearAttacker = centerAttacker; // トスを上げた攻撃者(スパイクの速さに使う)
    const serveTime = config.serveTime || SERVE_TIME;
    const serveError = config.serveError || DEFAULT_SERVE_ERROR;
    let lastTossDeviation = 0; // 直前のトスが狙いからずれた距離(スパイクのブレに上乗せする)
    const attackersByZone = { left: leftAttacker, center: centerAttacker, right: rightAttacker };

    // 相手チーム6人。ブロックはこちらの攻撃ごとに担当を決め、レシーブは毎回最寄りの選手が行う。
    const farPlayers = config.farPlayers.map(p => ({
      name: p.name,
      baseX: p.pos.x,
      baseZ: p.pos.z,
      blockFromX: p.pos.x,   // ブロックで寄り始めた位置
      blockTargetX: p.pos.x, // ブロックで寄る先(こちらの打点に合わせてトスごとに決まる)
      blockReach: p.blockReach || DEFAULT_BLOCK_REACH,
      blockPower: p.blockPower || DEFAULT_BLOCK_POWER,
      attackPower: p.attackPower || DEFAULT_BLOCK_POWER,
      speed: p.speed || DEFAULT_PLAYER_SPEED,
      reach: p.reach || DIVE_REACH,
      jumpHeight: p.jumpHeight || JUMP_HEIGHT,
      spikeTime: p.spikeTime || SPIKE_TIME,
      spikeError: p.spikeError || DEFAULT_SPIKE_ERROR,
      passError: p.passError || DEFAULT_PASS_ERROR,
      tossError: p.tossError || DEFAULT_TOSS_ERROR,
      x: p.pos.x,
      y: 0,
      z: p.pos.z,
      activity: 'idle', // 'idle' | 'block' | 'receive' | 'attack'
      phase: 'idle',
      phaseStart: 0,
      approachFrom: null,
      approachTo: null,
      approachDuration: 0,
      returnFrom: null
    }));
    // レシーブを受けるセッター役、そこから打つアタッカー役(近チームのセッター/レフトと同じ関係を相手側にも用意する)。
    const receiveTargetPlayer =
      farPlayers.find(p => p.name === 'far-front-2') || farPlayers[0];
    // 相手の攻撃者は前衛の左右(far-front-1 / far-front-3)。トスごとにどちらかを選ぶ。
    const farAttackers = ['far-front-1', 'far-front-3']
      .map(name => farPlayers.find(p => p.name === name))
      .filter(Boolean);
    if (!farAttackers.length) farAttackers.push(farPlayers[0]);
    let farAttacker = farAttackers[0]; // 今回トスが上がった相手の攻撃者

    // 自チームのレシーブ担当(near-back-1/2)。落下点に最も近い選手が自動で拾う。
    const nearReceivers = config.nearReceivers.map(p => ({
      name: p.name,
      baseX: p.pos.x,
      baseZ: p.pos.z,
      speed: p.speed || DEFAULT_PLAYER_SPEED,
      reach: p.reach || DIVE_REACH,
      passError: p.passError || DEFAULT_PASS_ERROR,
      tossError: p.tossError || DEFAULT_TOSS_ERROR, // セッターが1本目を拾った時に代わりにトスを上げる
      x: p.pos.x,
      y: 0,
      z: p.pos.z,
      activity: 'idle', // 'idle' | 'receive' | 'set'
      phase: 'idle',
      phaseStart: 0,
      approachFrom: null,
      approachTo: null,
      approachDuration: 0,
      returnFrom: null
    }));

    // ---- 可変状態 ----
    const target = { x: 0, z: -d.COURT_L / 4 }; // 初期位置は相手コートの中央固定

    const ball = {
      x: serveOrigin.x, y: serveOrigin.y, z: serveOrigin.z,
      rotX: 0, rotZ: 0,
      flightState: 'idle' // 'idle' | 'flying' | 'netFalling' | 'received' | 'landed'
    };

    // 自分側のブロッカー(センター攻撃者=near-front-2 のスロットを兼任)。相手が攻撃してくる間だけ
    // ジョイスティックの左右で位置を操作でき、ジャンプ自体は自動で行われる。
    const nearBlockRange = {
      xMin: -(d.COURT_W / 2 - BLOCK_SIDE_MARGIN),
      xMax: d.COURT_W / 2 - BLOCK_SIDE_MARGIN
    };
    const nearBlocker = {
      baseX: config.centerAttackerPos.x,
      baseZ: config.centerAttackerPos.z,
      x: config.centerAttackerPos.x,
      y: 0,
      z: config.centerAttackerPos.z,
      controlActive: false,
      // 前衛センターのブロック力(センター攻撃者と同じ選手)
      blockReach: (config.attackers && config.attackers.center && config.attackers.center.blockReach) || DEFAULT_BLOCK_REACH,
      blockPower: (config.attackers && config.attackers.center && config.attackers.center.blockPower) || DEFAULT_BLOCK_POWER,
      phase: 'idle', // 'idle' | 'jumping' | 'landing' | 'returning'
      phaseStart: 0,
      jumpX: config.centerAttackerPos.x,
      returnFrom: null
    };

    // 近チームのセッター(near-server)。サーブはコート外(serveX/Z)から打ち、打った後はコートの
    // 守備位置(baseX/Z = 後衛ライト)に入って3人目の後衛として守る。ラリーが終わるとサーブ位置へ戻る。
    // 返球が上がるとその位置へ寄っていき(activity 'set')、寄っている間のジョイスティック入力で
    // トス方向(レフト/センター/ライト)を決める。
    const setterAbility = config.setter || {};
    const setterCourtPos = config.setterCourtPos || {
      x: config.serverPos.x,
      z: config.nearReceivers.length ? config.nearReceivers[0].pos.z : d.COURT_L / 2 - 2
    };
    const nearSetter = {
      name: 'near-server',
      serveX: config.serverPos.x,
      serveZ: config.serverPos.z,
      baseX: setterCourtPos.x,
      baseZ: setterCourtPos.z,
      speed: setterAbility.speed || DEFAULT_PLAYER_SPEED,
      reach: setterAbility.reach || DIVE_REACH,
      passError: setterAbility.passError || DEFAULT_PASS_ERROR,
      tossError: setterAbility.tossError || DEFAULT_TOSS_ERROR,
      x: config.serverPos.x,
      y: 0,
      z: config.serverPos.z,
      activity: 'idle', // 'idle' | 'receive' | 'set' | 'toServe'
      phase: 'idle',
      phaseStart: 0,
      approachFrom: null,
      approachTo: null,
      approachDuration: 0,
      returnFrom: null
    };
    let settingPlayer = null; // 今トスを上げに寄っている選手(通常はセッター、セッターが1本目を拾ったら代わりの選手)
    let pendingTossZone = 'center';
    let blockTouchSide = 'near'; // ワンタッチで弾いたボールを拾う側

    let time = 0;

    // ラリーの勝敗。最後にボールに触ったチーム(lastHitter)と、落ちた場所で決める。
    const NEAR_FLIGHTS = { serve: true, toss: true, spike: true, nearReceivePass: true };
    let lastHitter = 'near';
    let netFault = false;      // 今のボールがネットにかかったか
    let rallyResolved = true;  // 今のボールの勝敗を記録済みか
    let rallyCount = 0;
    let lastRally = null;      // { winner: 'near'|'far', reason: 'in'|'out'|'net'|'block'|'blockout' }
    let pendingBlock = null;   // 今の打球がネット上でブロックに当たる予定 { side, result }

    function resolveRally() {
      const other = lastHitter === 'near' ? 'far' : 'near';
      let winner, reason;
      if (netFault) {
        winner = other; reason = 'net';
      } else {
        const side = ball.z >= 0 ? 'near' : 'far';
        if (isInCourt(ball, side)) {
          winner = side === 'near' ? 'far' : 'near';
          reason = flight.kind === 'blockStuff' ? 'block' : 'in';
        } else {
          winner = other;
          reason = flight.kind === 'blockOut' ? 'blockout' : 'out';
        }
      }
      rallyCount++;
      lastRally = { winner: winner, reason: reason };
      rallyResolved = true;
    }
    let tossActive = false;
    let farTossActive = false;

    const flight = {
      kind: 'serve', // 'serve' | 'toss' | 'spike' | 'receivePass' | 'farToss' | 'farSpike' | 'incomingSpike' | 'nearReceivePass'
      from: Object.assign({}, serveOrigin),
      to: Object.assign({}, serveOrigin),
      arcHeight: SERVE_ARC_HEIGHT,
      duration: SERVE_TIME,
      endT: 1,
      start: 0
    };
    let landedAt = 0;
    let netFall = { from: 0, x: 0, z: 0, start: 0 };

    function sampleParabola(t) {
      const x = lerp(flight.from.x, flight.to.x, t);
      const z = lerp(flight.from.z, flight.to.z, t);
      const baseY = lerp(flight.from.y, flight.to.y, t);
      const y = baseY + 4 * flight.arcHeight * t * (1 - t);
      return { x: x, y: y, z: z };
    }

    // 共通の打球処理本体（実行中の飛行を打ち切って開始する場合にも使う＝スパイクがトスを中断する）。
    // hitter: 打ったチーム('near'|'far')。省略時は kind から決める(ブロックの跳ね返りは跳んだ側)。
    function beginFlight(kind, from, to, arcHeight, duration, checkNet, hitter) {
      flight.kind = kind;
      flight.from = Object.assign({}, from);
      flight.to = Object.assign({}, to);
      flight.arcHeight = arcHeight;

      let endT = 1;
      if (checkNet) {
        const tNet = clamp((flight.from.z - 0) / (flight.from.z - flight.to.z), 0.02, 0.98);
        const netPoint = sampleParabola(tNet);
        const willHitNet = netPoint.y < d.NET_TOP + ballRadius + 0.03;
        endT = willHitNet ? tNet : 1;
      }

      flight.endT = endT;
      flight.duration = duration * flight.endT;
      flight.start = time;
      ball.flightState = 'flying';
      lastHitter = hitter || (NEAR_FLIGHTS[kind] ? 'near' : 'far');
      pendingBlock = null;
      netFault = false;
      rallyResolved = false;
    }

    // ボールの着地点がコート内か(ライン上はイン)。side: 'near'(z>0) | 'far'(z<0)
    function isInCourt(p, side) {
      if (Math.abs(p.x) > d.COURT_W / 2 + ballRadius) return false;
      return side === 'near'
        ? p.z >= 0 && p.z <= d.COURT_L / 2 + ballRadius
        : p.z <= 0 && p.z >= -(d.COURT_L / 2 + ballRadius);
    }

    // トスが攻撃者の高さに届いた瞬間、自動でスパイクを打つ。
    // ネットを越えてコート内に落ちる打球なら、相手が自動でレシーブに走る(ラリー継続)。
    function autoSpike(fromPoint) {
      tossActive = false;
      const spikeOrigin = vec(fromPoint.x, fromPoint.y, fromPoint.z);
      // 狙った位置から、攻撃者の精度(+トスのずれ)に応じてブレる
      const sigma = currentNearAttacker.spikeError + lastTossDeviation * TOSS_ERROR_TO_SPIKE;
      const spikeTarget = scatter(vec(target.x, ballRadius + 0.02, target.z), sigma);
      beginFlight('spike', spikeOrigin, spikeTarget, SPIKE_ARC_HEIGHT, currentNearAttacker.spikeTime, true);
      if (flight.endT < 1) return; // ネット
      if (checkBlock('far', spikeOrigin, spikeTarget, farBlockSpans(), currentNearAttacker.attackPower)) return;
      prepareReceive(spikeTarget);
    }

    // サーブを打った瞬間(=着地点が決まった瞬間)に、最寄りの選手を先読みで走らせ始める。
    // こうすることで「ボールが来てから動き出す」のではなく、ボールが来る位置へ
    // 先回りして待ち構える、というレシーブらしい動きになる。
    let currentReceiver = null;

    // レシーブに参加できる状態か(立っている・レシーブ中・フェイントのカバー中)。
    function canReceive_(p) {
      return p.activity === 'idle' || p.activity === 'receive' || p.activity === 'cover';
    }

    // 着地点に最も近い選手を(現在位置基準で)選ぶ。アウトの打球は誰も追わない。
    // ブロック・攻撃・トス・サーブ位置への移動中の選手はレシーブに参加できない
    // (＝ブロッカーの後ろ/横が狙い目になる)。
    function nearestReceiver(candidates, landingPoint) {
      let receiver = null, bestDist = Infinity;
      candidates.forEach(p => {
        if (!canReceive_(p)) return;
        const dist = Math.hypot(landingPoint.x - p.x, landingPoint.z - p.z);
        if (dist < bestDist) { bestDist = dist; receiver = p; }
      });
      return receiver ? { receiver: receiver, dist: bestDist } : null;
    }

    // 落下の瞬間に、レシーバーが飛びつける距離まで寄れているか。
    function reachedBall(receiver, landingPoint) {
      return Math.hypot(receiver.x - landingPoint.x, receiver.z - landingPoint.z) <= receiver.reach;
    }

    function prepareReceive(landingPoint) {
      if (!isInCourt(landingPoint, 'far')) return;
      const pick = nearestReceiver(farPlayers, landingPoint);
      if (!pick) return;
      const receiver = pick.receiver;
      const bestDist = pick.dist;

      currentReceiver = receiver;
      receiver.activity = 'receive';
      receiver.phase = 'approach';
      receiver.phaseStart = time + REACTION_TIME; // 反応するまではその場で構えたまま
      receiver.approachFrom = { x: receiver.x, z: receiver.z };
      receiver.approachTo = { x: landingPoint.x, z: landingPoint.z };
      receiver.approachDuration = Math.max(bestDist / receiver.speed, RECEIVE_MOVE_MIN);
    }

    // ネットにかかった等でレシーブが不要になった場合、待機中の選手を定位置へ戻す。
    function cancelReceive() {
      if (!currentReceiver) return;
      const r = currentReceiver;
      currentReceiver = null;
      r.returnFrom = { x: r.x, z: r.z };
      r.phase = 'returning';
      r.phaseStart = time;
    }

    // ボールが実際に落ちてきた瞬間の処理。既に待ち構えていればすぐ返球し、
    // 万一まだ到達していなければその場でボールに合わせてから返球する。
    function finalizeReceive(landingPoint) {
      ball.x = landingPoint.x; ball.y = landingPoint.y; ball.z = landingPoint.z;
      ball.flightState = 'received';

      const receiver = currentReceiver;
      currentReceiver = null;
      if (!receiver || !reachedBall(receiver, landingPoint)) {
        // 誰も追っていない(アウト)か、間に合わなかった＝ボールが落ちてラリー終了。
        ball.flightState = 'landed';
        landedAt = time;
        if (receiver) {
          receiver.returnFrom = { x: receiver.x, z: receiver.z };
          receiver.phase = 'returning';
          receiver.phaseStart = time;
        }
        return;
      }

      receiver.x = landingPoint.x;
      receiver.z = landingPoint.z;
      beginReceivePass(receiver);
      receiver.returnFrom = { x: receiver.x, z: receiver.z };
      receiver.phase = 'returning';
      receiver.phaseStart = time;
    }

    // レシーブ担当がボールに追いついた瞬間、セッター位置へ返球する。
    function beginReceivePass(receiver) {
      const from = vec(receiver.x, ball.y, receiver.z);
      const aim = vec(receiveTargetPlayer.baseX, RECEIVE_TARGET_HEIGHT, receiveTargetPlayer.baseZ);
      const to = scatter(aim, receiver.passError); // レシーブ精度に応じて返球がずれる
      beginFlight('receivePass', from, to, RECEIVE_ARC_HEIGHT, RECEIVE_TIME, false);
    }

    // 相手セッターがレシーブを受け取った瞬間、相手アタッカーへトスを上げる
    // (近チームの beginNearToss() と対になる、相手側の攻撃シーケンス)。
    function beginFarToss(fromPoint) {
      farAttacker = farAttackers[Math.floor(Math.random() * farAttackers.length)];
      const from = vec(fromPoint.x, fromPoint.y, fromPoint.z);
      // 攻撃者の定位置から少し内側・ネット寄りへ上げる
      const inward = farAttacker.baseX < 0 ? 0.3 : (farAttacker.baseX > 0 ? -0.3 : 0);
      const aim = vec(farAttacker.baseX + inward, TOSS_TARGET_HEIGHT, farAttacker.baseZ - 0.2);
      const to = scatter(aim, receiveTargetPlayer.tossError); // セッターのトス精度
      lastTossDeviation = Math.hypot(to.x - aim.x, to.z - aim.z);
      beginFlight('farToss', from, to, TOSS_ARC_HEIGHT, TOSS_TIME, false);
      farTossActive = true;
      farAttacker.attackFromX = farAttacker.x;
      farAttacker.attackFromZ = farAttacker.z;
      farAttacker.activity = 'attack';
      farAttacker.phase = 'approach';
      farAttacker.phaseStart = time;

      setupNearBlockAndCover(to.x);
    }

    // こちらのブロック(ネット上で塞いでいる x の範囲)。前衛センターは操作中の位置、
    // サイドのブロッカーは寄っている先の位置で、それぞれ blockReach の幅を塞ぐ。
    function nearBlockSpans() {
      const spans = [];
      if (nearBlocker.controlActive) {
        spans.push({ x: nearBlocker.x, reach: nearBlocker.blockReach, power: nearBlocker.blockPower });
      }
      [leftAttacker, rightAttacker].forEach(p => {
        if (p.activity === 'block' && p.phase === 'move') {
          spans.push({ x: p.moveTo.x, reach: p.blockReach, power: p.blockPower });
        }
      });
      return spans;
    }

    // 相手のブロック(こちらの攻撃に対して跳んでいる選手の、寄っている先の位置)。
    function farBlockSpans() {
      return farPlayers
        .filter(p => p.activity === 'block')
        .map(p => ({ x: p.blockTargetX, reach: p.blockReach, power: p.blockPower }));
    }

    // スパイクのコースがブロックの範囲を通るなら、当たり判定をして結果を決める。
    // 当たった場合は、ボールがネット上(ブロックの位置)に来たところで resolveBlock() が跳ね返りを始める。
    // blockSide: ブロックしている側('near'|'far')。戻り値: ブロックに当たるなら true。
    function checkBlock(blockSide, origin, spikeTarget, spans, attackPower) {
      if (!spans.length || flight.endT < 1) return false;
      const tNet = clamp(origin.z / (origin.z - spikeTarget.z), 0.02, 0.98);
      const xAtNet = lerp(origin.x, spikeTarget.x, tNet);
      let blocker = null;
      spans.forEach(b => {
        if (Math.abs(xAtNet - b.x) <= b.reach && (!blocker || Math.abs(xAtNet - b.x) < Math.abs(xAtNet - blocker.x))) {
          blocker = b;
        }
      });
      if (!blocker) return false;

      const diff = blocker.power - attackPower;
      if (Math.random() >= clamp(BLOCK_TOUCH_BASE + diff * 0.01, 0.3, 0.9)) return false; // 当たらず通過
      const pStuff = clamp(BLOCK_STUFF_BASE + diff * 0.01, 0.1, 0.6);
      const pOut = clamp(BLOCK_OUT_BASE - diff * 0.005, 0.05, 0.3);
      const r = Math.random();
      const result = r < pStuff ? 'stuff' : (r < pStuff + pOut ? 'out' : 'touch');

      // ネットの上まで飛んだところで止め、そこから跳ね返らせる
      flight.endT = tNet;
      flight.duration *= tNet;
      pendingBlock = { side: blockSide, result: result };
      return true;
    }

    // ボールがブロックに当たった瞬間の跳ね返り。
    //   stuff: 攻撃側のコートのネット際へ叩き落とす(ブロック側の得点)
    //   touch: ブロック側のコートへ山なりに弾く(ブロック側が拾ってラリー続行)
    //   out  : ブロック側のコートの外へ弾く(攻撃側の得点。最後に触ったのはブロック側)
    function resolveBlock(p) {
      const b = pendingBlock;
      pendingBlock = null;
      const into = b.side === 'near' ? 1 : -1; // ブロック側コートの z の向き
      const from = vec(p.x, p.y, p.z);
      let to;
      if (b.result === 'stuff') {
        to = vec(clamp(p.x + (Math.random() * 2 - 1), -d.COURT_W / 2 + 0.3, d.COURT_W / 2 - 0.3),
          ballRadius + 0.02, -into * (0.5 + Math.random() * 1.5));
        beginFlight('blockStuff', from, to, 0.3, 0.5, false, b.side);
      } else if (b.result === 'touch') {
        to = vec(clamp(p.x * 0.5 + (Math.random() * 2 - 1) * 1.5, -d.COURT_W / 2 + 0.5, d.COURT_W / 2 - 0.5),
          ballRadius + 0.02, into * (2 + Math.random() * 4));
        beginFlight('blockTouch', from, to, 2.4, 1.4, false, b.side);
        blockTouchSide = b.side;
        if (b.side === 'near') prepareNearReceive(to); else prepareReceive(to);
      } else {
        const sideSign = p.x < 0 ? -1 : (p.x > 0 ? 1 : (Math.random() < 0.5 ? -1 : 1));
        to = vec(sideSign * (d.COURT_W / 2 + 0.8 + Math.random() * 1.5),
          ballRadius + 0.02, into * (1 + Math.random() * 4));
        beginFlight('blockOut', from, to, 1.2, 0.9, false, b.side);
      }
    }

    // 打点 origin から点 c へ打った時、ネット(z=0)を通る位置がブロックで塞がれているか。
    function isBlockedCourse(origin, c, spans) {
      if (!spans.length || origin.z >= 0 || c.z <= 0) return false;
      const t = -origin.z / (c.z - origin.z);
      const xAtNet = lerp(origin.x, c.x, t);
      return spans.some(b => Math.abs(xAtNet - b.x) <= b.reach);
    }

    // 相手スパイクの狙い。こちらのコート内(ネットから FAR_AIM_MIN_DEPTH 以上奥、ラインから
    // FAR_AIM_MARGIN 内側)にランダムな候補を FAR_AIM_CANDIDATES 個作り、ブロックで塞がれていない
    // コースのうち、レシーブできる選手から一番遠い候補(守備の隙)を狙う(全部塞がれていたら
    // 塞がれていても一番の隙を狙う)。そこからアタッカーの精度(+トスのずれ)に応じてブレるので、
    // ブレてアウトやネットになることもある。
    function farSpikeTarget(origin) {
      const spans = nearBlockSpans();
      const defenders = nearReceiveCandidates.filter(canReceive_);
      let aim = null, bestGap = -Infinity;
      for (let i = 0; i < FAR_AIM_CANDIDATES; i++) {
        const c = vec(
          (Math.random() * 2 - 1) * (d.COURT_W / 2 - FAR_AIM_MARGIN),
          ballRadius + 0.02,
          FAR_AIM_MIN_DEPTH + Math.random() * (d.COURT_L / 2 - FAR_AIM_MIN_DEPTH - FAR_AIM_MARGIN)
        );
        let gap = Infinity;
        defenders.forEach(p => { gap = Math.min(gap, Math.hypot(c.x - p.x, c.z - p.z)); });
        // 塞がれたコースは、塞がれていない候補より必ず後回しにする
        if (isBlockedCourse(origin, c, spans)) gap -= 1000;
        if (gap > bestGap) { bestGap = gap; aim = c; }
      }
      return scatter(aim, farAttacker.spikeError + lastTossDeviation * TOSS_ERROR_TO_SPIKE);
    }

    // 相手アタッカーへのトスが届いた瞬間、自動でこちら側のコートへスパイクを打つ。
    // コート内に落ちる打球なら、こちらのレシーバーが自動で拾いに走る(ラリー継続)。
    function autoFarSpike(fromPoint) {
      farTossActive = false;
      const spikeOrigin = vec(fromPoint.x, fromPoint.y, fromPoint.z);
      const blockSpans = nearBlockSpans(); // 跳ぶ直前のブロックの位置で判定する
      const spikeTarget = farSpikeTarget(spikeOrigin);
      beginFlight('farSpike', spikeOrigin, spikeTarget, SPIKE_ARC_HEIGHT, farAttacker.spikeTime, true);
      if (flight.endT === 1 && !checkBlock('near', spikeOrigin, spikeTarget, blockSpans, farAttacker.attackPower)) {
        prepareNearReceive(spikeTarget);
      }

      // 相手の打つ瞬間に合わせて、サイドのブロッカーも一緒に跳ぶ。
      [leftAttacker, rightAttacker].forEach(a => {
        if (a.activity === 'block' && a.phase === 'move') {
          a.phase = 'jumping';
          a.phaseStart = time;
        }
      });

      // 相手の打つ瞬間に合わせて、操作していた位置でブロックジャンプする。
      nearBlocker.controlActive = false;
      nearBlocker.jumpX = nearBlocker.x;
      nearBlocker.phase = 'jumping';
      nearBlocker.phaseStart = time;
    }

    function updateBlocker(state, now) {
      if (state.activity !== 'block') return;
      if (state.phase === 'approach') {
        const elapsed = now - state.phaseStart;
        const jumpStart = TOSS_TIME - JUMP_DURATION_BLOCK;

        const moveT = Math.min(1, elapsed / TOSS_TIME);
        state.x = lerp(state.blockFromX, state.blockTargetX, moveT);
        state.z = state.baseZ;

        if (elapsed < jumpStart) {
          state.y = 0;
        } else {
          const u = Math.min(1, (elapsed - jumpStart) / JUMP_DURATION_BLOCK);
          state.y = BLOCK_JUMP_HEIGHT * Math.sin(Math.PI / 2 * u);
        }

        if (elapsed >= TOSS_TIME) {
          state.phase = 'landing';
          state.phaseStart = now;
        }
      } else if (state.phase === 'landing') {
        const lt = Math.min(1, (now - state.phaseStart) / LAND_DURATION);
        state.y = lerp(BLOCK_JUMP_HEIGHT, 0, lt);
        state.x = state.blockTargetX;
        if (lt >= 1) {
          state.phase = 'returning';
          state.phaseStart = now;
        }
      } else if (state.phase === 'returning') {
        const rt = Math.min(1, (now - state.phaseStart) / BLOCK_RETURN_DURATION);
        state.x = lerp(state.blockTargetX, state.baseX, rt);
        state.y = 0;
        if (rt >= 1) {
          state.activity = 'idle';
          state.phase = 'idle';
          state.x = state.baseX;
          state.z = state.baseZ;
        }
      }
    }

    function updateReceiver(state, now) {
      if (state.activity !== 'receive') return;
      if (state.phase === 'approach') {
        const t = clamp((now - state.phaseStart) / state.approachDuration, 0, 1);
        state.x = lerp(state.approachFrom.x, state.approachTo.x, t);
        state.z = lerp(state.approachFrom.z, state.approachTo.z, t);
        state.y = 0;
        if (t >= 1) {
          state.phase = 'waiting'; // 先回りが完了。ボールが実際に届くまでその場で構える
        }
      } else if (state.phase === 'waiting') {
        // ボールの到着(finalizeReceive)を待つだけ。位置はそのまま。
      } else if (state.phase === 'returning') {
        const dist = Math.hypot(state.baseX - state.returnFrom.x, state.baseZ - state.returnFrom.z);
        const duration = clamp(dist / state.speed, RECEIVE_RETURN_MIN, RECEIVE_RETURN_MAX);
        const t = Math.min(1, (now - state.phaseStart) / duration);
        state.x = lerp(state.returnFrom.x, state.baseX, t);
        state.z = lerp(state.returnFrom.z, state.baseZ, t);
        if (t >= 1) {
          state.activity = 'idle';
          state.phase = 'idle';
          state.x = state.baseX;
          state.z = state.baseZ;
        }
      }
    }

    // 攻撃選手の自動助走・ジャンプ(近チームのレフト/センター/ライト、相手チームのアタッカーで共用。
    // dirZ: 自陣からネットに向かう方向の符号。近チームは -Z 方向、相手は +Z 方向に向かう)。
    function updateAttack(state, now, dirZ) {
      if (state.activity !== 'attack') return;
      if (state.phase === 'approach') {
        const elapsed = now - state.phaseStart;
        const jumpStart = TOSS_TIME - JUMP_DURATION_ATTACK;
        if (elapsed < jumpStart) {
          // 助走を始めた位置(通常は定位置。レシーブ直後ならその位置)から踏み切り位置へ
          const rt = elapsed / jumpStart;
          state.x = lerp(state.attackFromX, state.baseX, rt);
          state.z = lerp(state.attackFromZ, state.baseZ + dirZ * APPROACH_DIST, rt);
          state.y = 0;
        } else {
          const u = Math.min(1, (elapsed - jumpStart) / JUMP_DURATION_ATTACK);
          state.x = state.baseX;
          state.z = state.baseZ + dirZ * APPROACH_DIST;
          state.y = state.jumpHeight * Math.sin(Math.PI / 2 * u);
        }
        if (elapsed >= TOSS_TIME) {
          state.phase = 'landing';
          state.phaseStart = now;
        }
      } else if (state.phase === 'landing') {
        const lt = Math.min(1, (now - state.phaseStart) / LAND_DURATION);
        state.y = lerp(state.jumpHeight, 0, lt);
        state.z = lerp(state.baseZ + dirZ * APPROACH_DIST, state.baseZ, lt);
        if (lt >= 1) {
          state.activity = 'idle';
          state.phase = 'idle';
          state.x = state.baseX;
          state.z = state.baseZ;
        }
      }
    }

    // 相手のトスが上がった瞬間、トスの上がった側の前衛はブロック位置へ寄り、
    // 反対側の前衛はネットから下がってフェイント/インナーのカバーに入る。
    // attackX: 相手の打点の x(トスの到達点)。ほぼ中央なら左右どちらも動かない。
    function setupNearBlockAndCover(attackX) {
      if (Math.abs(attackX) < 1) return;
      const wing = attackX < 0 ? leftAttacker : rightAttacker;
      const opposite = wing === leftAttacker ? rightAttacker : leftAttacker;
      [wing, opposite].forEach(p => {
        // 攻撃中・レシーブ中の選手はそのまま(それ以外の動きを優先しない)
        if (p.activity === 'attack' || (p.activity === 'receive' && p.phase !== 'returning')) return;
        p.moveFrom = { x: p.x, z: p.z };
        p.phaseStart = time;
        if (p === wing) {
          p.activity = 'block';
          p.phase = 'move';
          p.moveTo = { x: clamp(attackX, nearBlockRange.xMin, nearBlockRange.xMax), z: p.baseZ };
        } else {
          p.activity = 'cover';
          p.phase = 'move';
          p.moveTo = { x: p.baseX * COVER_X_RATIO, z: COVER_DEPTH };
        }
      });
    }

    // サイドの前衛のブロック(寄る→跳ぶ→着地→戻る)とカバー(下がる→構える)の動き。
    function updateNearWing(state, now) {
      if (state.activity === 'cover') {
        const t = Math.min(1, (now - state.phaseStart) / COVER_MOVE_TIME);
        state.x = lerp(state.moveFrom.x, state.moveTo.x, t);
        state.z = lerp(state.moveFrom.z, state.moveTo.z, t);
        state.y = 0;
        return;
      }
      if (state.activity !== 'block') return;
      if (state.phase === 'move') {
        const t = Math.min(1, (now - state.phaseStart) / WING_BLOCK_MOVE_TIME);
        state.x = lerp(state.moveFrom.x, state.moveTo.x, t);
        state.z = lerp(state.moveFrom.z, state.moveTo.z, t);
        state.y = 0;
      } else if (state.phase === 'jumping') {
        const u = Math.min(1, (now - state.phaseStart) / JUMP_DURATION_BLOCK);
        state.y = BLOCK_JUMP_HEIGHT * Math.sin(Math.PI / 2 * u);
        if (u >= 1) { state.phase = 'landing'; state.phaseStart = now; }
      } else if (state.phase === 'landing') {
        const lt = Math.min(1, (now - state.phaseStart) / LAND_DURATION);
        state.y = lerp(BLOCK_JUMP_HEIGHT, 0, lt);
        if (lt >= 1) {
          // 着地したら 'receive' の 'returning' で定位置へ戻る
          state.activity = 'receive';
          state.phase = 'returning';
          state.returnFrom = { x: state.x, z: state.z };
          state.phaseStart = now;
        }
      }
    }

    // 相手のスパイクが決着した(拾った/落ちた/ネット)ら、カバーに入っていた選手を定位置へ戻す。
    // 跳ばずに終わったブロッカー(ラリー終了時など)も同様に戻す。
    function releaseNearWings() {
      [leftAttacker, rightAttacker].forEach(p => {
        if (p.activity === 'cover' || (p.activity === 'block' && p.phase === 'move')) {
          p.activity = 'receive';
          p.phase = 'returning';
          p.returnFrom = { x: p.x, z: p.z };
          p.phaseStart = time;
        }
      });
    }

    // 自分側ブロッカー。相手のトス〜スパイクでボールが相手コート側(z<0)にある間は常に
    // ジョイスティック左右で位置を操作でき、ジャンプ自体(タイミング・高さ)は常に自動
    // (triggerされた位置で跳ぶだけ)。自チーム自身のスパイクが相手コートへ飛んでいく間は
    // ブロックとは無関係なので対象外にする。
    function updateNearBlocker(now, dt, joystickValue) {
      if (nearBlocker.phase === 'idle') {
        const isOpponentAttack = flight.kind === 'farToss' || flight.kind === 'farSpike';
        nearBlocker.controlActive = isOpponentAttack && ball.z < 0 && ball.flightState !== 'idle';
      }

      if (nearBlocker.controlActive) {
        nearBlocker.x += joystickValue.x * BLOCK_CONTROL_SPEED * dt;
        nearBlocker.x = clamp(nearBlocker.x, nearBlockRange.xMin, nearBlockRange.xMax);
      }

      if (nearBlocker.phase === 'jumping') {
        const u = Math.min(1, (now - nearBlocker.phaseStart) / JUMP_DURATION_BLOCK);
        nearBlocker.x = nearBlocker.jumpX;
        nearBlocker.y = BLOCK_JUMP_HEIGHT * Math.sin(Math.PI / 2 * u);
        if (u >= 1) {
          nearBlocker.phase = 'landing';
          nearBlocker.phaseStart = now;
        }
      } else if (nearBlocker.phase === 'landing') {
        const lt = Math.min(1, (now - nearBlocker.phaseStart) / LAND_DURATION);
        nearBlocker.x = nearBlocker.jumpX;
        nearBlocker.y = lerp(BLOCK_JUMP_HEIGHT, 0, lt);
        if (lt >= 1) {
          nearBlocker.returnFrom = { x: nearBlocker.x, z: nearBlocker.z };
          nearBlocker.phase = 'returning';
          nearBlocker.phaseStart = now;
        }
      } else if (nearBlocker.phase === 'returning') {
        const rt = Math.min(1, (now - nearBlocker.phaseStart) / BLOCK_RETURN_DURATION);
        nearBlocker.x = lerp(nearBlocker.returnFrom.x, nearBlocker.baseX, rt);
        nearBlocker.y = 0;
        if (rt >= 1) {
          nearBlocker.phase = 'idle';
          nearBlocker.x = nearBlocker.baseX;
          nearBlocker.z = nearBlocker.baseZ;
        }
      }
    }

    // ---------- 近チームのレシーブ〜セッター〜トス ----------

    // 相手のスパイクが飛んでくる瞬間(=着地点が決まった瞬間)に、最寄りのレシーバーを先読みで走らせる。
    let currentNearReceiver = null;
    // レシーブできる選手: 後衛2人・セッター(コート内にいる時)・前衛レフト/ライト。
    // 前衛センターはブロッカーを兼ねるので含めない。
    const nearReceiveCandidates = nearReceivers.concat([nearSetter, leftAttacker, rightAttacker]);

    function prepareNearReceive(landingPoint) {
      if (!isInCourt(landingPoint, 'near')) return;
      const pick = nearestReceiver(nearReceiveCandidates, landingPoint);
      if (!pick) return;
      const receiver = pick.receiver;
      const bestDist = pick.dist;

      currentNearReceiver = receiver;
      receiver.activity = 'receive';
      receiver.phase = 'approach';
      receiver.phaseStart = time + REACTION_TIME; // 反応するまではその場で構えたまま
      receiver.approachFrom = { x: receiver.x, z: receiver.z };
      receiver.approachTo = { x: landingPoint.x, z: landingPoint.z };
      receiver.approachDuration = Math.max(bestDist / receiver.speed, RECEIVE_MOVE_MIN);
    }

    function cancelNearReceive() {
      releaseNearWings();
      if (!currentNearReceiver) return;
      const r = currentNearReceiver;
      currentNearReceiver = null;
      r.returnFrom = { x: r.x, z: r.z };
      r.phase = 'returning';
      r.phaseStart = time;
    }

    function finalizeNearReceive(landingPoint) {
      ball.x = landingPoint.x; ball.y = landingPoint.y; ball.z = landingPoint.z;
      ball.flightState = 'received';

      const receiver = currentNearReceiver;
      currentNearReceiver = null;
      releaseNearWings();
      if (!receiver || !reachedBall(receiver, landingPoint)) {
        ball.flightState = 'landed';
        landedAt = time;
        if (receiver) {
          receiver.returnFrom = { x: receiver.x, z: receiver.z };
          receiver.phase = 'returning';
          receiver.phaseStart = time;
        }
        return;
      }

      receiver.x = landingPoint.x;
      receiver.z = landingPoint.z;
      beginNearReceivePass(receiver);
      receiver.returnFrom = { x: receiver.x, z: receiver.z };
      receiver.phase = 'returning';
      receiver.phaseStart = time;
    }

    // レシーバーがボールに追いついた瞬間、待機点(passTargetPoint)へ返球する。
    // 同時にトスを上げる選手がその位置へ走り出し、寄っている間のスティック入力でトス方向を決める。
    function beginNearReceivePass(receiver) {
      const from = vec(receiver.x, ball.y, receiver.z);
      const to = scatter(passTargetPoint, receiver.passError); // レシーブ精度に応じて返球がずれる
      beginFlight('nearReceivePass', from, to, RECEIVE_ARC_HEIGHT, RECEIVE_TIME, false);

      const setter = chooseNearSetter(receiver);
      settingPlayer = setter;
      setter.activity = 'set';
      setter.phase = 'approach';
      setter.phaseStart = time;
      setter.approachFrom = { x: setter.x, z: setter.z };
      setter.approachTo = { x: to.x, z: to.z }; // 実際に返ってきた位置へ寄る
      setter.approachDuration = RECEIVE_TIME;
      pendingTossZone = 'center';
    }

    // トスを上げる選手。通常はセッター、セッター自身が1本目を拾った時は、残りの後衛のうち
    // トスが一番うまい(tossError が小さい)選手が代わりに上げる。
    function chooseNearSetter(receiver) {
      if (receiver !== nearSetter) return nearSetter;
      let best = null;
      nearReceivers.forEach(p => {
        if (p === receiver) return;
        if (!best || p.tossError < best.tossError) best = p;
      });
      return best || nearSetter;
    }

    // トスを上げる選手がボールに寄っている間、ジョイスティックの左右でトス方向を決め、
    // 到達した瞬間にその方向の攻撃者へトスを上げる。上げた後は自分の守備位置へ戻る。
    function updateNearSetting(now, joystickValue) {
      const setter = settingPlayer;
      if (!setter || setter.activity !== 'set') return;
      // スティックがレフト/ライトへ倒された瞬間にその方向を確定させ、指を離して
      // ニュートラルに戻っても選択が消えないようにする(センターへは明示的に戻した時だけ)。
      const zone = zoneFromJoystickX(joystickValue.x);
      if (zone !== 'center') {
        pendingTossZone = zone;
      }

      const t = Math.min(1, (now - setter.phaseStart) / setter.approachDuration);
      setter.x = lerp(setter.approachFrom.x, setter.approachTo.x, t);
      setter.z = lerp(setter.approachFrom.z, setter.approachTo.z, t);
      setter.y = 0;
      if (t >= 1) {
        beginNearToss(pendingTossZone, setter);
        settingPlayer = null;
        setter.activity = 'receive'; // 'receive' の 'returning' で守備位置へ戻る
        setter.phase = 'returning';
        setter.returnFrom = { x: setter.x, z: setter.z };
        setter.phaseStart = now;
      }
    }

    // トスを上げる瞬間、確定した方向の攻撃者へトスを上げる。
    function beginNearToss(zone, setter) {
      const attacker = attackersByZone[zone] || centerAttacker;
      currentNearAttacker = attacker;
      const from = vec(setter.x, SETTER_HEIGHT, setter.z);
      const aim = attackTargets[zone] || attackTargets.center;
      const to = scatter(aim, setter.tossError); // トスを上げる選手の精度
      lastTossDeviation = Math.hypot(to.x - aim.x, to.z - aim.z);
      beginFlight('toss', from, to, TOSS_ARC_HEIGHT, TOSS_TIME, false);
      tossActive = true;
      attacker.attackFromX = attacker.x;
      attacker.attackFromZ = attacker.z;
      attacker.activity = 'attack';
      attacker.phase = 'approach';
      attacker.phaseStart = time;
      setupFarBlock(to.x);
    }

    // こちらのトスが上がった瞬間、相手のセンター(far-front-2)と、打点側の前衛(far-front-1 / far-front-3)が
    // 打点へ寄ってブロックに跳ぶ(打つ瞬間にジャンプのピークが来る)。センターは打点の内側に並ぶ。
    function setupFarBlock(attackX) {
      const center = farPlayers.find(p => p.name === 'far-front-2');
      const wing = farPlayers.find(p => p.name === (attackX < 0 ? 'far-front-1' : 'far-front-3'));
      const range = d.COURT_W / 2 - BLOCK_SIDE_MARGIN;
      [wing, center].forEach(p => {
        if (!p) return;
        const isWing = p === wing && Math.abs(attackX) >= 1;
        if (p === wing && !isWing) return; // ほぼ中央への攻撃ならセンター1枚
        p.activity = 'block';
        p.phase = 'approach';
        p.phaseStart = time; // 打つ瞬間に合わせてブロックのジャンプもピークにする
        p.blockFromX = p.x;
        const inward = attackX < 0 ? 0.7 : -0.7;
        p.blockTargetX = clamp(isWing ? attackX : (Math.abs(attackX) >= 1 ? attackX + inward : attackX), -range, range);
      });
    }

    // セッターをコートの守備位置へ入らせる(サーブを打った後・相手の攻撃から始まる練習の時)。
    function setterEnterCourt() {
      nearSetter.activity = 'receive'; // 'receive' の 'returning' で守備位置(baseX/Z)へ走る
      nearSetter.phase = 'returning';
      nearSetter.returnFrom = { x: nearSetter.x, z: nearSetter.z };
      nearSetter.phaseStart = time;
    }

    // ラリーが終わったら、セッター(サーバー)は次のサーブのためにサーブ位置へ戻る。
    function setterToServe() {
      releaseNearWings();
      settingPlayer = null;
      nearSetter.activity = 'toServe';
      nearSetter.phase = 'returning';
      nearSetter.returnFrom = { x: nearSetter.x, z: nearSetter.z };
      nearSetter.phaseStart = time;
    }

    function updateSetterToServe(now) {
      if (nearSetter.activity !== 'toServe') return;
      const from = nearSetter.returnFrom;
      const dist = Math.hypot(nearSetter.serveX - from.x, nearSetter.serveZ - from.z);
      const duration = clamp(dist / nearSetter.speed, RECEIVE_RETURN_MIN, RECEIVE_RETURN_MAX);
      const t = Math.min(1, (now - nearSetter.phaseStart) / duration);
      nearSetter.x = lerp(from.x, nearSetter.serveX, t);
      nearSetter.z = lerp(from.z, nearSetter.serveZ, t);
      nearSetter.y = 0;
      if (t >= 1) {
        nearSetter.activity = 'idle';
        nearSetter.phase = 'idle';
      }
    }

    // ---------- 外部コマンド ----------
    function canServe() { return ball.flightState === 'idle'; }
    function canReceive() { return ball.flightState === 'idle'; }

    function serve() {
      if (!canServe()) return;
      // 狙った位置から、サーバーの精度に応じてブレる
      const landing = scatter(vec(target.x, ballRadius + 0.02, target.z), serveError);
      beginFlight('serve', serveOrigin, landing, SERVE_ARC_HEIGHT, serveTime, true);
      prepareReceive(landing); // 着地点が決まった瞬間、相手選手を先回りさせる
      // サーバー(セッター)はサーブ位置から打ち、そのままコートの守備位置へ入る
      nearSetter.x = nearSetter.serveX;
      nearSetter.z = nearSetter.serveZ;
      setterEnterCourt();
    }

    // 相手コートからボールが飛んでくる(練習用トリガー)。自チームが受けて拾う。
    function incomingAttack() {
      if (!canReceive()) return;
      const origin = vec(farAttacker.baseX, TOSS_TARGET_HEIGHT, farAttacker.baseZ - 0.2);
      const nearX = (Math.random() * 2 - 1) * (d.COURT_W / 2 - 1);
      const nearZ = 1 + Math.random() * (d.COURT_L / 2 - 2);
      const landing = vec(nearX, ballRadius + 0.02, nearZ);
      beginFlight('incomingSpike', origin, landing, SPIKE_ARC_HEIGHT, farAttacker.spikeTime, true);
      setterEnterCourt(); // セッターも守備位置へ(着地点の判定はこの時点の位置で行う)
      prepareNearReceive(landing);
    }

    // ---------- 毎フレーム更新 ----------
    // joystickValue: {x, y} 各 -1〜1。ジョイスティックは「倒した方向にカーソルが進む」速度入力として扱う。
    function update(dt, joystickValue) {
      time += dt;
      const now = time;

      // ---- ボールの飛行 ----
      if (ball.flightState === 'flying') {
        const progress = Math.min(1, (now - flight.start) / flight.duration);
        const t = progress * flight.endT;
        const p = sampleParabola(t);
        ball.x = p.x; ball.y = p.y; ball.z = p.z;
        ball.rotX += dt * 9;
        ball.rotZ += dt * 6;
        if (progress >= 1) {
          if (pendingBlock) {
            resolveBlock(p);
          } else if (flight.endT < 1) {
            ball.flightState = 'netFalling';
            netFault = true;
            netFall = { from: p.y, x: p.x, z: p.z, start: now };
            cancelReceive();
            cancelNearReceive();
          } else if (tossActive) {
            autoSpike(p);
          } else if (farTossActive) {
            autoFarSpike(p);
          } else if (flight.kind === 'serve' || flight.kind === 'spike') {
            finalizeReceive(p);
          } else if (flight.kind === 'incomingSpike' || flight.kind === 'farSpike') {
            finalizeNearReceive(p);
          } else if (flight.kind === 'blockTouch') {
            // ワンタッチで弾いたボールは、ブロックした側が拾う
            if (blockTouchSide === 'near') finalizeNearReceive(p); else finalizeReceive(p);
          } else if (flight.kind === 'receivePass') {
            beginFarToss(p);
          } else if (flight.kind === 'nearReceivePass') {
            // トスを上げる選手の寄り到達(updateNearSetting)に合わせて beginNearToss が呼ばれるため、
            // ここでは通常の着地扱いにしておく(実際にはその前にトス飛行へ上書きされる想定)。
            ball.flightState = 'landed';
            landedAt = now;
          } else {
            ball.flightState = 'landed';
            landedAt = now;
          }
        }
      } else if (ball.flightState === 'netFalling') {
        const ft = now - netFall.start;
        const y = Math.max(ballRadius, netFall.from - 0.5 * GRAVITY * ft * ft);
        ball.x = netFall.x; ball.y = y; ball.z = netFall.z;
        ball.rotX += dt * 9;
        ball.rotZ += dt * 6;
        if (y <= ballRadius) {
          ball.flightState = 'landed';
          landedAt = now;
        }
      } else if (ball.flightState === 'landed') {
        if (now - landedAt > LANDED_HOLD) {
          ball.flightState = 'idle';
          tossActive = false; // 打たれずにトスが終わったら、スパイクは打てなくする
          // ラリー終了。次のサーブに備えてボールをサーブ位置へ戻す。
          ball.x = serveOrigin.x; ball.y = serveOrigin.y; ball.z = serveOrigin.z;
        }
      }

      // ---- 自チーム攻撃選手(レフト/センター/ライト)の自動助走・ジャンプ ----
      [leftAttacker, centerAttacker, rightAttacker].forEach(a => updateAttack(a, now, -1));
      // ---- 前衛レフト/ライトのブロック・カバー ----
      [leftAttacker, rightAttacker].forEach(a => updateNearWing(a, now));

      // ---- 自チームのレシーブ(後衛2人・セッター・前衛レフト/ライト) ----
      nearReceiveCandidates.forEach(p => updateReceiver(p, now));

      // ---- トスを上げる選手(寄り＋方向確定)、セッターのサーブ位置への移動 ----
      updateNearSetting(now, joystickValue);
      updateSetterToServe(now);

      // ---- 相手チーム(ブロック/レシーブ/アタック)の自動アクション ----
      farPlayers.forEach(p => {
        updateBlocker(p, now);
        updateReceiver(p, now);
        updateAttack(p, now, 1); // 相手は自陣(-Z)からネット(z=0)に向かうので +方向
      });

      // ---- 自分側ブロッカー ----
      updateNearBlocker(now, dt, joystickValue);

      // ---- ラリーの勝敗 ----
      // ボールが落ちた(landed)時点で記録する。セッターへの返球が着地扱いになった直後に
      // トスで上書きされるケースがあるので、各選手の更新が済んだここで判定する。
      if (ball.flightState === 'landed' && !rallyResolved) {
        resolveRally();
        setterToServe();
      }

      // ---- 狙い位置マーカー ----
      // 「サーブ待ち(idle)」または「トスが上がってスパイクの狙いを決めている間(tossActive)」
      // だけスティックで動かす。ブロック操作中や、セッターがボールに寄っている間(その間は
      // スティックがトス方向選択に使われる)は動かさない。この判定は上記の各更新(特に
      // tossActiveをONにするupdateNearSettingと、controlActiveを決めるupdateNearBlocker)の
      // あとに行うことで、トスが上がった当フレームから即座に操作できるようにしている。
      if (!nearBlocker.controlActive && (ball.flightState === 'idle' || tossActive)) {
        const sq = discToSquare(joystickValue.x, joystickValue.y);
        target.x += sq.x * MARKER_SPEED * dt;
        target.z += -sq.y * MARKER_SPEED * dt; // yプラス=奥へ進む
        target.x = clamp(target.x, serveRange.xMin, serveRange.xMax);
        target.z = clamp(target.z, serveRange.zFar, serveRange.zNet);
      }
    }

    function getState() {
      // near-front-2 はセンター攻撃者とブロッカーを兼任するスロット。攻撃動作中はその座標を、
      // それ以外はブロッカーの座標を優先して出す(両者は時間的に排他)。
      const centerSlot = centerAttacker.phase !== 'idle'
        ? { x: centerAttacker.x, y: centerAttacker.y, z: centerAttacker.z }
        : { x: nearBlocker.x, y: nearBlocker.y, z: nearBlocker.z };

      return {
        target: { x: target.x, z: target.z },
        // 狙い位置カーソルは、サーブ待ち(idle)かスパイクの狙いを決めている間(tossActive)だけ表示する。
        targetVisible: ball.flightState === 'idle' || tossActive,
        ball: { x: ball.x, y: ball.y, z: ball.z, rotX: ball.rotX, rotZ: ball.rotZ, flightState: ball.flightState },
        leftAttacker: { x: leftAttacker.x, y: leftAttacker.y, z: leftAttacker.z },
        centerAttacker: centerSlot,
        rightAttacker: { x: rightAttacker.x, y: rightAttacker.y, z: rightAttacker.z },
        nearSetter: { x: nearSetter.x, y: nearSetter.y, z: nearSetter.z },
        nearReceivers: nearReceivers.map(p => ({ name: p.name, x: p.x, y: p.y, z: p.z })),
        tossZone: settingPlayer && settingPlayer.activity === 'set' ? pendingTossZone : null,
        farPlayers: farPlayers.map(p => ({ name: p.name, x: p.x, y: p.y, z: p.z })),
        canServe: canServe(),
        canReceive: canReceive(),
        rallyCount: rallyCount,
        lastRally: lastRally
      };
    }

    return {
      update: update,
      serve: serve,
      receive: incomingAttack,
      canServe: canServe,
      canReceive: canReceive,
      getState: getState
    };
  }

  global.VolleyballSimulation = Object.freeze({ create: create });
})(window);
