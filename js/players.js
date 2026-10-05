/**
 * VolleyballPlayers モデル
 * 選手（簡易ローポリ人型）を6人×2チーム、コート上の定位置に配置するモジュール。
 * THREE.js のグローバル(THREE)と VolleyballCourt.DIMENSIONS にのみ依存する。
 * ゲーム側は VolleyballPlayers.create() で Group を取得し、自分の scene に add するだけで良い。
 */
(function (global) {
  'use strict';

  const PLAYER = Object.freeze({
    HEIGHT: 1.8,
    LEG_H: 0.9,
    LEG_R: 0.16,
    TORSO_H: 0.6,
    TORSO_R: 0.19,
    HEAD_R: 0.13
  });

  // コート上の6ポジション（センター寄りのオフセット。x: 左-3 / 中央0 / 右+3）
  const FORMATION_X = [-3, 0, 3];

  function makePlayer(jerseyColor, skinColor) {
    const group = new THREE.Group();

    const legMat = new THREE.MeshStandardMaterial({ color: 0x27314a, roughness: 0.8 });
    const legs = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAYER.LEG_R, PLAYER.LEG_R * 0.85, PLAYER.LEG_H, 12),
      legMat
    );
    legs.position.y = PLAYER.LEG_H / 2;
    legs.castShadow = true;
    group.add(legs);

    const torsoMat = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.7 });
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(PLAYER.TORSO_R, PLAYER.TORSO_R * 1.05, PLAYER.TORSO_H, 12),
      torsoMat
    );
    torso.position.y = PLAYER.LEG_H + PLAYER.TORSO_H / 2;
    torso.castShadow = true;
    group.add(torso);

    // 肩・腕（簡易カプセル代わりに細い円柱）
    const armMat = torsoMat;
    [-1, 1].forEach(side => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8), armMat);
      arm.position.set(side * (PLAYER.TORSO_R + 0.05), PLAYER.LEG_H + PLAYER.TORSO_H - 0.15, 0);
      arm.castShadow = true;
      group.add(arm);
    });

    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(PLAYER.HEAD_R, 16, 12), headMat);
    head.position.y = PLAYER.LEG_H + PLAYER.TORSO_H + PLAYER.HEAD_R + 0.03;
    head.castShadow = true;
    group.add(head);

    return group;
  }

  /**
   * @param {Object} [options]
   * @param {number} [options.teamNearColor] - 手前チーム（自陣）のジャージ色
   * @param {number} [options.teamFarColor]  - 奥チーム（相手陣）のジャージ色
   * @param {number} [options.skinColor]
   * @returns {THREE.Group} 'VolleyballPlayers' という名前の Group（12人 = 6人×2チーム）
   */
  function create(options) {
    const opt = Object.assign({
      teamNearColor: 0x2b6fd1,
      teamFarColor: 0xd1352b,
      skinColor: 0xe0ac6a
    }, options || {});

    const d = (global.VolleyballCourt && global.VolleyballCourt.DIMENSIONS) || {
      ATTACK_LINE_DIST: 3, COURT_L: 18
    };

    const group = new THREE.Group();
    group.name = 'VolleyballPlayers';

    const frontZ = 1.5;                          // ネットから1.5m（自陣前衛）
    const backZ = d.COURT_L / 2 - 1.5;            // ベースラインの1.5m内側（自陣後衛）
    const serveZ = d.COURT_L / 2 + 1.2;           // ベースラインの1.2m外側（サーブ位置）
    // 自陣の後衛は左・中央の2人。右後衛の位置にはサーブを打った後のサーバー(セッター兼任)が入る
    // (x=+3、同じ深さ。位置は VolleyballSimulation の setterCourtPos)。
    const nearBackX = [-3, 0];
    const nearBackZ = d.COURT_L / 2 - 2;

    // ---------- 手前チーム（自陣・サーブ側。ネットの方を向く = -Z方向） ----------
    // 3人が前衛、2人が後衛、1人（右後衛=ポジション1）はサーブのためベースライン外に立つ。
    const nearTeam = new THREE.Group();
    nearTeam.name = 'team-near';

    FORMATION_X.forEach((x, i) => {
      const front = makePlayer(opt.teamNearColor, opt.skinColor);
      front.position.set(x, 0, frontZ);
      front.rotation.y = Math.PI; // -Z を向く
      front.name = 'near-front-' + (i + 1);
      nearTeam.add(front);
    });

    nearBackX.forEach((x, i) => {
      const back = makePlayer(opt.teamNearColor, opt.skinColor);
      back.position.set(x, 0, nearBackZ);
      back.rotation.y = Math.PI;
      back.name = 'near-back-' + (i + 1);
      nearTeam.add(back);
    });

    const server = makePlayer(opt.teamNearColor, opt.skinColor);
    server.position.set(3, 0, serveZ);
    server.rotation.y = Math.PI;
    server.name = 'near-server';
    nearTeam.add(server);

    group.add(nearTeam);

    // ---------- 奥チーム（相手陣・ネットの方を向く = +Z方向） ----------
    const farTeam = new THREE.Group();
    farTeam.name = 'team-far';
    FORMATION_X.forEach((x, i) => {
      const front = makePlayer(opt.teamFarColor, opt.skinColor);
      front.position.set(x, 0, -frontZ);
      front.name = 'far-front-' + (i + 1); // デフォルトで +Z を向く
      farTeam.add(front);

      const back = makePlayer(opt.teamFarColor, opt.skinColor);
      back.position.set(x, 0, -backZ);
      back.name = 'far-back-' + (i + 1);
      farTeam.add(back);
    });
    group.add(farTeam);

    return group;
  }

  global.VolleyballPlayers = Object.freeze({
    PLAYER_DIMENSIONS: PLAYER,
    create: create
  });
})(window);
