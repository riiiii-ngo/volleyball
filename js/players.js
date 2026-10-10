/**
 * VolleyballPlayers モデル
 * 選手（簡易ローポリ人型）のメッシュを、チームごと(6人+リベロ)に作るモジュール。
 * 関節(腰・股・膝・肩・肘)ごとに回せる人型で、背中と胸に背番号を付ける。身長に合わせて大きさを変える。
 * animate() で、走る・構える・レシーブ・トス・スパイク・ブロック・サーブの体の動き(モーション)を付ける。
 * THREE.js のグローバル(THREE)にのみ依存する。立ち位置は持たない(毎フレーム VolleyballGame が置く)。
 */
(function (global) {
  'use strict';

  // 身長180cmの時の大きさ(m)。選手ごとに身長/180 倍する
  const PLAYER = Object.freeze({
    HEIGHT: 1.8,
    THIGH: 0.45,
    SHIN: 0.43,
    LEG_H: 0.9,      // 足の裏から股関節まで(靴の厚み0.02を含む)
    LEG_R: 0.075,
    HIP_W: 0.1,      // 股関節の左右の間隔の半分
    TORSO_H: 0.6,
    TORSO_R: 0.19,
    TORSO_DEPTH: 0.72, // 胴の前後の厚み(半径に対する比)
    SHOULDER_Y: 0.54,
    UPPER_ARM: 0.3,
    FOREARM: 0.27,
    ARM_R: 0.042,
    HEAD_R: 0.13
  });
  const BASE_HEIGHT_CM = 180;

  // ---------- 姿勢 ----------
  // 関節の角度(ラジアン)。
  //   lean: 上体の前傾(+で前) / twist: 上体のひねり(+で左を向く)
  //   hipL/hipR: 脚の前後(-で前へ上げる) / kneeL/kneeR: 膝の曲げ(+) / spread: 脚の開き
  //   shL/shR: 腕の前後(-で前・上へ上げる。-π で真上) / abL/abR: 腕の開き(+で外、-で内) / elL/elR: 肘の曲げ(-で前へ曲げる)
  const JOINTS = ['lean', 'twist', 'hipL', 'hipR', 'kneeL', 'kneeR', 'spread', 'shL', 'shR', 'abL', 'abR', 'elL', 'elR'];

  const STAND = { lean: 0.04, twist: 0, hipL: 0, hipR: 0, kneeL: 0.05, kneeR: 0.05, spread: 0.06,
    shL: 0.08, shR: 0.08, abL: 0.12, abR: 0.12, elL: -0.25, elR: -0.25 };
  // ラリー中の構え(腰を落として腕を前に)
  const READY = { lean: 0.38, twist: 0, hipL: -0.55, hipR: -0.55, kneeL: 1.0, kneeR: 1.0, spread: 0.16,
    shL: -0.55, shR: -0.55, abL: 0.25, abR: 0.25, elL: -1.0, elR: -1.0 };
  // 空中(動作の無いジャンプ)
  const AIR = { lean: 0.05, twist: 0, hipL: -0.3, hipR: -0.3, kneeL: 0.7, kneeR: 0.7, spread: 0.08,
    shL: -1.2, shR: -1.2, abL: 0.35, abR: 0.35, elL: -0.6, elR: -0.6 };

  // 腕・脚を左右同じ値にする書き方の省略
  function both(o) {
    const out = {};
    Object.keys(o).forEach(k => {
      if (k === 'sh' || k === 'ab' || k === 'el' || k === 'hip' || k === 'knee') { out[k + 'L'] = o[k]; out[k + 'R'] = o[k]; }
      else out[k] = o[k];
    });
    return out;
  }

  // 動作のキーフレーム。t は触る時刻(跳ぶ動作はジャンプの最高点)からの秒。右腕で打つ。
  // 書いていない関節は前後のキーの値、どのキーにも無い関節は土台の姿勢(構え・走り)のまま。
  const ACTIONS = {
    // レシーブ: 腰を落として両腕をそろえて前へ出し(面を作る)、当てたら少し押し上げる
    pass: [
      [-0.55, both({ lean: 0.45, hip: -0.7, knee: 1.2, sh: -0.85, ab: -0.25, el: -0.35 })],
      [0, both({ lean: 0.5, hip: -0.8, knee: 1.3, sh: -1.1, ab: -0.36, el: 0 })],
      [0.22, both({ lean: 0.35, hip: -0.5, knee: 0.85, sh: -1.35, ab: -0.36, el: 0 })],
      [0.42, both({ lean: 0.35, hip: -0.5, knee: 0.85, sh: -0.9, ab: -0.1, el: -0.4 })]
    ],
    // 飛びついてレシーブ: 上体を投げ出し、片脚を後ろへ伸ばす
    dive: [
      [-0.5, Object.assign(both({ sh: -0.9, ab: -0.25, el: -0.3 }), { lean: 0.6, hipL: -0.8, kneeL: 1.3, hipR: -0.3, kneeR: 0.6 })],
      [0, Object.assign(both({ sh: -1.25, ab: -0.36, el: 0 }), { lean: 1.05, hipL: -1.0, kneeL: 1.5, hipR: 0.55, kneeR: 0.25 })],
      [0.45, Object.assign(both({ sh: -1.3, ab: -0.3, el: -0.1 }), { lean: 1.0, hipL: -1.0, kneeL: 1.5, hipR: 0.55, kneeR: 0.25 })],
      [0.75, both({ lean: 0.4, hip: -0.5, knee: 0.9, sh: -0.7, ab: 0.1, el: -0.6 })]
    ],
    // オーバーハンドのトス: 両手を額の上に構え、膝と肘を伸ばして送り出す
    set: [
      [-0.6, both({ lean: 0.05, hip: -0.35, knee: 0.7, sh: -2.35, ab: 0.45, el: -1.7 })],
      [-0.05, both({ lean: -0.08, hip: -0.3, knee: 0.6, sh: -2.6, ab: 0.4, el: -1.5 })],
      [0.12, both({ lean: -0.12, hip: 0, knee: 0.1, sh: -2.95, ab: 0.2, el: -0.2 })],
      [0.35, both({ lean: 0, hip: -0.1, knee: 0.25, sh: -2.6, ab: 0.25, el: -0.5 })]
    ],
    // アンダーの二段トス: レシーブの形から大きく振り上げる
    bump: [
      [-0.5, both({ lean: 0.4, hip: -0.65, knee: 1.15, sh: -0.85, ab: -0.25, el: -0.35 })],
      [0, both({ lean: 0.4, hip: -0.7, knee: 1.2, sh: -1.1, ab: -0.36, el: 0 })],
      [0.25, both({ lean: 0.1, hip: -0.2, knee: 0.35, sh: -1.75, ab: -0.36, el: 0 })],
      [0.45, both({ lean: 0.15, hip: -0.3, knee: 0.5, sh: -1.2, ab: -0.1, el: -0.4 })]
    ],
    // スパイク: 助走→両腕を後ろへ振って踏み切り→両腕を振り上げ→右腕を引いて胸を張り→振り下ろす→着地
    spike: [
      [-0.8, both({ lean: 0.35, hip: -0.4, knee: 0.7, sh: 0.25, ab: 0.15, el: -0.4 })],
      [-0.46, both({ lean: 0.55, hip: -0.75, knee: 1.25, sh: 0.95, ab: 0.2, el: -0.1 })],
      [-0.3, Object.assign(both({ hip: -0.2, knee: 0.3 }), { lean: 0.05, shL: -2.5, shR: -2.1, abL: 0.2, abR: 0.5, elL: -0.3, elR: -1.0 })],
      [-0.1, Object.assign(both({ hip: 0.05, knee: 0.85 }), { lean: -0.3, twist: -0.4, shL: -2.6, shR: -2.55, abL: 0.25, abR: 0.75, elL: -0.4, elR: -2.1 })],
      [0, Object.assign(both({ hip: -0.15, knee: 0.6 }), { lean: 0.15, twist: 0.15, shL: -1.3, shR: -2.95, abL: 0.3, abR: 0.25, elL: -0.7, elR: -0.05 })],
      [0.14, Object.assign(both({ hip: -0.35, knee: 0.7 }), { lean: 0.45, twist: 0.25, shL: -0.3, shR: -0.8, abL: 0.2, abR: 0.1, elL: -0.6, elR: -0.3 })],
      [0.42, both({ lean: 0.35, twist: 0, hip: -0.55, knee: 1.05, sh: -0.4, ab: 0.2, el: -0.6 })]
    ],
    // フェイント: 打つ直前まではスパイクと同じ。肘を少し曲げたまま指先で落とす
    tip: [
      [-0.8, both({ lean: 0.35, hip: -0.4, knee: 0.7, sh: 0.25, ab: 0.15, el: -0.4 })],
      [-0.46, both({ lean: 0.55, hip: -0.75, knee: 1.25, sh: 0.95, ab: 0.2, el: -0.1 })],
      [-0.3, Object.assign(both({ hip: -0.2, knee: 0.3 }), { lean: 0.05, shL: -2.5, shR: -2.1, abL: 0.2, abR: 0.5, elL: -0.3, elR: -1.0 })],
      [-0.1, Object.assign(both({ hip: 0.05, knee: 0.85 }), { lean: -0.2, twist: -0.3, shL: -2.6, shR: -2.6, abL: 0.25, abR: 0.6, elL: -0.4, elR: -1.6 })],
      [0, Object.assign(both({ hip: -0.1, knee: 0.6 }), { lean: 0, twist: 0, shL: -1.6, shR: -3.0, abL: 0.3, abR: 0.2, elL: -0.7, elR: -0.5 })],
      [0.2, Object.assign(both({ hip: -0.3, knee: 0.7 }), { lean: 0.2, shL: -0.6, shR: -2.3, abL: 0.2, abR: 0.2, elL: -0.6, elR: -0.4 })],
      [0.45, both({ lean: 0.3, twist: 0, hip: -0.5, knee: 1.0, sh: -0.4, ab: 0.2, el: -0.6 })]
    ],
    // ブロック: 手を肩の前に構え、沈んでから真上へ両腕を伸ばして跳ぶ
    block: [
      [-0.6, both({ lean: 0.15, hip: -0.35, knee: 0.7, sh: -1.1, ab: 0.45, el: -1.7 })],
      [-0.3, both({ lean: 0.3, hip: -0.7, knee: 1.3, sh: -1.3, ab: 0.4, el: -1.6 })],
      [-0.08, both({ lean: -0.05, hip: -0.1, knee: 0.3, sh: -3.0, ab: 0.14, el: -0.1 })],
      [0.2, both({ lean: 0, hip: -0.15, knee: 0.45, sh: -3.0, ab: 0.14, el: -0.1 })],
      [0.42, both({ lean: 0.2, hip: -0.5, knee: 1.0, sh: -2.3, ab: 0.3, el: -0.7 })],
      [0.65, both({ lean: 0.25, hip: -0.45, knee: 0.9, sh: -1.1, ab: 0.4, el: -1.5 })]
    ],
    // フローターサーブ: 左手でトスを上げ、右腕を引いて、腕を伸ばして打つ
    floatServe: [
      [-0.75, { lean: 0.1, shL: -1.2, abL: 0.0, elL: -0.5, shR: -0.4, abR: 0.2, elR: -0.9, hipL: -0.25, kneeL: 0.2, hipR: 0.1, kneeR: 0.15 }],
      [-0.45, { lean: -0.05, twist: -0.3, shL: -2.7, abL: 0.05, elL: -0.1, shR: -2.2, abR: 0.75, elR: -1.9 }],
      [-0.15, { lean: -0.1, twist: -0.35, shL: -1.6, abL: 0.2, elL: -0.5, shR: -2.65, abR: 0.65, elR: -2.0 }],
      [0, { lean: 0.1, twist: 0.15, shL: -0.9, elL: -0.6, shR: -2.85, abR: 0.3, elR: -0.05 }],
      [0.2, { lean: 0.25, twist: 0.2, shL: -0.4, shR: -1.4, abR: 0.15, elR: -0.2, hipL: -0.1, kneeL: 0.2, hipR: 0.2, kneeR: 0.3 }],
      [0.45, both({ lean: 0.15, twist: 0, hip: 0, knee: 0.15, sh: -0.3, ab: 0.15, el: -0.4 })]
    ],
    // ジャンプサーブ: トスを上げてから助走し、スパイクと同じように打つ
    jumpServe: [
      [-0.75, { lean: 0.1, shL: -1.0, elL: -0.5, shR: -1.0, elR: -0.5, abL: 0.0, abR: 0.0 }],
      [-0.6, both({ lean: 0.05, sh: -2.6, ab: 0.1, el: -0.1 })],
      [-0.46, both({ lean: 0.55, hip: -0.75, knee: 1.25, sh: 0.95, ab: 0.2, el: -0.1 })],
      [-0.3, Object.assign(both({ hip: -0.2, knee: 0.3 }), { lean: 0.05, shL: -2.5, shR: -2.1, abL: 0.2, abR: 0.5, elL: -0.3, elR: -1.0 })],
      [-0.1, Object.assign(both({ hip: 0.05, knee: 0.85 }), { lean: -0.3, twist: -0.4, shL: -2.6, shR: -2.55, abL: 0.25, abR: 0.75, elL: -0.4, elR: -2.1 })],
      [0, Object.assign(both({ hip: -0.15, knee: 0.6 }), { lean: 0.15, twist: 0.15, shL: -1.3, shR: -2.95, abL: 0.3, abR: 0.25, elL: -0.7, elR: -0.05 })],
      [0.14, Object.assign(both({ hip: -0.35, knee: 0.7 }), { lean: 0.45, twist: 0.25, shL: -0.3, shR: -0.8, abL: 0.2, abR: 0.1, elL: -0.6, elR: -0.3 })],
      [0.42, both({ lean: 0.35, twist: 0, hip: -0.55, knee: 1.05, sh: -0.4, ab: 0.2, el: -0.6 })]
    ]
  };
  const FADE_IN = 0.15;   // 動作の始まりで土台の姿勢から移る秒数
  const FADE_OUT = 0.3;   // 最後のキーから土台の姿勢へ戻る秒数

  // キーフレームを関節ごとの [t, 値] の列にしておく
  const TRACKS = {};
  Object.keys(ACTIONS).forEach(kind => {
    const keys = ACTIONS[kind];
    const tracks = {};
    keys.forEach(([t, pose]) => {
      Object.keys(pose).forEach(j => { (tracks[j] = tracks[j] || []).push([t, pose[j]]); });
    });
    TRACKS[kind] = { start: keys[0][0], end: keys[keys.length - 1][0], tracks: tracks };
  });

  function smooth(u) { return u * u * (3 - 2 * u); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function sample(track, t) {
    if (t <= track[0][0]) return track[0][1];
    for (let i = 1; i < track.length; i++) {
      if (t <= track[i][0]) {
        const a = track[i - 1], b = track[i];
        const u = smooth((t - a[0]) / (b[0] - a[0]));
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return track[track.length - 1][1];
  }

  /**
   * その瞬間の姿勢(関節の角度)を決める。
   * @param {Object} info
   * @param {boolean} info.ready - 構える(ラリー中のコート上の選手)
   * @param {number} info.run - 走りの強さ 0〜1
   * @param {number} info.phase - 走りの脚の振りの位相(ラジアン)
   * @param {boolean} info.airborne - 跳んでいる
   * @param {{kind:string, t:number}|null} info.action - 動作と、触る時刻からの経過秒
   */
  function computePose(info) {
    const base = info.ready ? READY : STAND;
    const pose = {};
    const a = clamp01(info.run || 0);
    const s = Math.sin(info.phase || 0);
    // 走り: 脚を交互に振り、腕は逆に振る。速いほど大きく・前傾
    const run = {
      lean: 0.15 + 0.2 * a, twist: 0.12 * a * s,
      hipL: -0.85 * s, hipR: 0.85 * s,
      kneeL: 0.25 + 1.1 * Math.max(0, Math.cos(info.phase || 0)), kneeR: 0.25 + 1.1 * Math.max(0, -Math.cos(info.phase || 0)),
      spread: 0.05,
      shL: 0.75 * s, shR: -0.75 * s, abL: 0.15, abR: 0.15, elL: -1.4, elR: -1.4
    };
    const runW = smooth(a);
    JOINTS.forEach(j => {
      let v = base[j] + (run[j] - base[j]) * runW;
      if (info.airborne) v = AIR[j];
      pose[j] = v;
    });
    const act = info.action && TRACKS[info.action.kind];
    if (act) {
      const t = info.action.t;
      const w = smooth(clamp01((t - act.start) / FADE_IN)) * smooth(clamp01((act.end + FADE_OUT - t) / FADE_OUT));
      if (w > 0) {
        Object.keys(act.tracks).forEach(j => {
          pose[j] = pose[j] + (sample(act.tracks[j], t) - pose[j]) * w;
        });
      }
    }
    return pose;
  }

  // ---------- メッシュ ----------
  // チームの色ごとのマテリアル・共通のジオメトリ(14人で使い回す)
  function makeShared() {
    const P = PLAYER;
    const g = {
      thigh: new THREE.CylinderGeometry(P.LEG_R * 1.12, P.LEG_R, P.THIGH, 10),
      shin: new THREE.CylinderGeometry(P.LEG_R * 0.95, P.LEG_R * 0.7, P.SHIN, 10),
      shoe: new THREE.BoxGeometry(0.11, 0.07, 0.24),
      sock: new THREE.CylinderGeometry(P.LEG_R * 0.78, P.LEG_R * 0.72, 0.16, 10),
      shorts: new THREE.CylinderGeometry(P.TORSO_R * 0.98, P.TORSO_R * 1.08, 0.24, 14),
      torso: new THREE.CylinderGeometry(P.TORSO_R * 1.08, P.TORSO_R * 0.92, P.TORSO_H, 16),
      neck: new THREE.CylinderGeometry(0.05, 0.055, 0.08, 8),
      head: new THREE.SphereGeometry(P.HEAD_R, 16, 12),
      hair: new THREE.SphereGeometry(P.HEAD_R * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      sleeve: new THREE.CylinderGeometry(P.ARM_R * 1.55, P.ARM_R * 1.4, 0.13, 10),
      upperArm: new THREE.CylinderGeometry(P.ARM_R * 1.05, P.ARM_R * 0.95, P.UPPER_ARM, 8),
      forearm: new THREE.CylinderGeometry(P.ARM_R * 0.95, P.ARM_R * 0.8, P.FOREARM, 8),
      hand: new THREE.SphereGeometry(0.048, 10, 8),
      numberBack: new THREE.PlaneGeometry(0.25, 0.25),
      numberFront: new THREE.PlaneGeometry(0.14, 0.14)
    };
    return g;
  }

  // 背番号のテクスチャ(白抜き+縁取り)。ユニフォームが明るい色なら紺の数字にする
  function numberTexture(number, jerseyColor) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const col = new THREE.Color(jerseyColor);
    const light = col.r * 0.3 + col.g * 0.59 + col.b * 0.11 > 0.6;
    ctx.font = '900 104px "Bebas Neue", "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(10,15,30,0.85)';
    ctx.fillStyle = light ? '#14213d' : '#ffffff';
    const text = String(number);
    ctx.strokeText(text, 64, 70);
    ctx.fillText(text, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  function mesh(geo, mat, y) {
    const m = new THREE.Mesh(geo, mat);
    if (y) m.position.y = y;
    m.castShadow = true;
    return m;
  }

  function makePlayer(shared, mats, number, heightCm) {
    const P = PLAYER;
    const root = new THREE.Group();
    // 身長に合わせて大きさを変える(全体を拡大・縮小)
    const scaled = new THREE.Group();
    const sc = (heightCm > 0 ? heightCm : BASE_HEIGHT_CM) / BASE_HEIGHT_CM;
    scaled.scale.setScalar(sc);
    root.add(scaled);

    // 腰(足が床に着くように上下する)
    const pelvis = new THREE.Group();
    pelvis.position.y = P.LEG_H;
    scaled.add(pelvis);
    pelvis.add(mesh(shared.shorts, mats.shorts, -0.04));

    const joints = { pelvis: pelvis };
    ['L', 'R'].forEach(side => {
      const sx = side === 'L' ? -1 : 1;
      const hip = new THREE.Group();
      hip.position.set(sx * P.HIP_W, -0.02, 0);
      pelvis.add(hip);
      hip.add(mesh(shared.thigh, mats.skin, -P.THIGH / 2));
      const knee = new THREE.Group();
      knee.position.y = -P.THIGH;
      hip.add(knee);
      knee.add(mesh(shared.shin, mats.skin, -P.SHIN / 2));
      knee.add(mesh(shared.sock, mats.sock, -P.SHIN + 0.1));
      const shoe = mesh(shared.shoe, mats.shoe, -P.SHIN - 0.01);
      shoe.position.z = 0.04;
      knee.add(shoe);
      joints['hip' + side] = hip;
      joints['knee' + side] = knee;
    });

    // 上体(腰を支点に前傾・ひねり)
    const chest = new THREE.Group();
    chest.rotation.order = 'YXZ';
    pelvis.add(chest);
    const torso = mesh(shared.torso, mats.jersey, P.TORSO_H / 2 + 0.04);
    torso.scale.z = P.TORSO_DEPTH;
    chest.add(torso);
    chest.add(mesh(shared.neck, mats.skin, P.TORSO_H + 0.07));
    const head = mesh(shared.head, mats.skin, P.TORSO_H + 0.08 + P.HEAD_R);
    chest.add(head);
    const hair = mesh(shared.hair, mats.hair, P.TORSO_H + 0.1 + P.HEAD_R);
    hair.rotation.x = -0.35; // 後ろ寄りにかぶせる
    chest.add(hair);
    joints.chest = chest;

    // 背番号(背中は大きく、胸は小さく)
    if (number != null) {
      const tex = numberTexture(number, mats.jersey.color.getHex());
      const numMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false });
      const back = new THREE.Mesh(shared.numberBack, numMat);
      back.position.set(0, P.TORSO_H * 0.55, -(P.TORSO_R * P.TORSO_DEPTH + 0.008));
      back.rotation.y = Math.PI;
      chest.add(back);
      const front = new THREE.Mesh(shared.numberFront, numMat);
      front.position.set(0.06, P.TORSO_H * 0.66, P.TORSO_R * P.TORSO_DEPTH * 1.05 + 0.008);
      chest.add(front);
    }

    ['L', 'R'].forEach(side => {
      const sx = side === 'L' ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * (P.TORSO_R + 0.055), P.SHOULDER_Y, 0);
      chest.add(shoulder);
      shoulder.add(mesh(shared.sleeve, mats.jersey, -0.05));
      shoulder.add(mesh(shared.upperArm, mats.skin, -P.UPPER_ARM / 2));
      const elbow = new THREE.Group();
      elbow.position.y = -P.UPPER_ARM;
      shoulder.add(elbow);
      elbow.add(mesh(shared.forearm, mats.skin, -P.FOREARM / 2));
      elbow.add(mesh(shared.hand, mats.skin, -P.FOREARM - 0.03));
      joints['sh' + side] = shoulder;
      joints['el' + side] = elbow;
    });

    root.userData.joints = joints;
    root.userData.pose = Object.assign({}, STAND);
    root.userData.runPhase = 0;
    root.userData.runAmount = 0;
    applyPose(root, root.userData.pose);
    return root;
  }

  // 関節の角度をメッシュに当てる。足の裏が床(または跳んだ高さ)に着くように腰の高さを決める。
  function applyPose(root, pose) {
    const P = PLAYER;
    const j = root.userData.joints;
    j.chest.rotation.x = pose.lean;
    j.chest.rotation.y = pose.twist;
    j.hipL.rotation.set(pose.hipL, 0, -pose.spread);
    j.hipR.rotation.set(pose.hipR, 0, pose.spread);
    j.kneeL.rotation.x = pose.kneeL;
    j.kneeR.rotation.x = pose.kneeR;
    j.shL.rotation.set(pose.shL, 0, -pose.abL);
    j.shR.rotation.set(pose.shR, 0, pose.abR);
    j.elL.rotation.x = pose.elL;
    j.elR.rotation.x = pose.elR;
    // 脚の縦の長さ(長い方の脚で立つ)
    const reach = (h, k) => P.THIGH * Math.cos(h) + (P.SHIN + 0.02) * Math.cos(h + k);
    const legL = reach(pose.hipL, pose.kneeL) * Math.cos(pose.spread);
    const legR = reach(pose.hipR, pose.kneeR) * Math.cos(pose.spread);
    j.pelvis.position.y = Math.max(legL, legR, 0.3);
  }

  // 走りの脚の振り: 1歩の周期で進む距離(m)。2歩で位相が 2π 進む
  const STRIDE = 2.2;
  const RUN_FULL_SPEED = 3.5; // この速さ(m/秒)で走りの振りが最大
  const POSE_RATE = 22;       // 姿勢が目標に近づく速さ(試合の時間あたり。急に形が変わらないように)

  /**
   * 選手1人の体の動きを1フレーム進める(VolleyballGame が毎フレーム呼ぶ)。
   * @param {THREE.Group} root - create() で作った選手のメッシュ
   * @param {Object} info
   * @param {number} info.dt - 試合の時間で進んだ秒(スロー中は小さくなる)
   * @param {number} info.moved - このフレームで床の上を動いた距離(m)
   * @param {boolean} info.ready - 構える(ラリー中のコート上の選手)
   * @param {boolean} info.airborne - 跳んでいる
   * @param {{kind:string, t:number}|null} info.action - 動作(VolleyballSimulation の getState().players[].action)
   */
  function animate(root, info) {
    const u = root.userData;
    const dt = Math.max(0, info.dt || 0);
    if (dt > 0) {
      const speed = (info.moved || 0) / dt;
      const target = info.airborne ? 0 : clamp01(speed / RUN_FULL_SPEED);
      u.runAmount += (target - u.runAmount) * (1 - Math.exp(-dt * 10));
      if (!info.airborne) u.runPhase = (u.runPhase + (info.moved || 0) / STRIDE * Math.PI * 2) % (Math.PI * 2);
    }
    const goal = computePose({ ready: info.ready, run: u.runAmount, phase: u.runPhase, airborne: info.airborne, action: info.action });
    const k = dt > 0 ? 1 - Math.exp(-dt * POSE_RATE) : 0;
    JOINTS.forEach(name => { u.pose[name] += (goal[name] - u.pose[name]) * k; });
    applyPose(root, u.pose);
  }

  /**
   * 選手のメッシュを id ごとに作る。立ち位置・向きは毎フレーム VolleyballGame が試合の状態から決める。
   * @param {Object} options
   * @param {{near: Array<{id:string, libero?:boolean, number?:number, height?:number}>, far: Array<...>}} options.teams
   *        number は背番号(無ければ付けない)、height は身長(cm。大きさを変える)
   * @param {number} [options.teamNearColor] - 手前チーム（自陣）のジャージ色
   * @param {number} [options.teamFarColor]  - 奥チーム（相手陣）のジャージ色
   * @param {number} [options.liberoNearColor] - 手前チームのリベロのジャージ色(リベロは違う色を着る)
   * @param {number} [options.liberoFarColor]
   * @param {number} [options.skinColor]
   * @returns {THREE.Group} 'VolleyballPlayers' という名前の Group。子の名前が選手の id
   */
  function create(options) {
    const opt = Object.assign({
      teamNearColor: 0x2b6fd1,
      teamFarColor: 0xd1352b,
      liberoNearColor: 0xe8d44d,
      liberoFarColor: 0x1fae7a,
      shortsNearColor: 0x1a2a52,
      shortsFarColor: 0x2a1418,
      skinColor: 0xe0ac6a,
      hairColor: 0x1c1712
    }, options || {});

    const shared = makeShared();
    const std = (color, rough) => new THREE.MeshStandardMaterial({ color: color, roughness: rough });
    const common = { skin: std(opt.skinColor, 0.6), hair: std(opt.hairColor, 0.8), shoe: std(0xf2f2f2, 0.5), sock: std(0xf7f7f7, 0.8) };
    const matsFor = (side, libero) => Object.assign({}, common, {
      jersey: std(libero ? (side === 'near' ? opt.liberoNearColor : opt.liberoFarColor)
        : (side === 'near' ? opt.teamNearColor : opt.teamFarColor), 0.7),
      shorts: std(side === 'near' ? opt.shortsNearColor : opt.shortsFarColor, 0.75)
    });

    const group = new THREE.Group();
    group.name = 'VolleyballPlayers';
    ['near', 'far'].forEach(side => {
      const teamGroup = new THREE.Group();
      teamGroup.name = 'team-' + side;
      const teamMats = { field: matsFor(side, false), libero: matsFor(side, true) };
      (opt.teams[side] || []).forEach(m => {
        const p = makePlayer(shared, m.libero ? teamMats.libero : teamMats.field, m.number, m.height);
        p.name = m.id;
        teamGroup.add(p);
      });
      group.add(teamGroup);
    });
    return group;
  }

  global.VolleyballPlayers = Object.freeze({
    PLAYER_DIMENSIONS: PLAYER,
    ACTION_KINDS: Object.freeze(Object.keys(ACTIONS)),
    create: create,
    animate: animate,
    computePose: computePose
  });
})(window);
