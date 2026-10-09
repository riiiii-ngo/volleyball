/**
 * VolleyballPlayers モデル
 * 選手（簡易ローポリ人型）のメッシュを、チームごと(6人+リベロ)に作るモジュール。
 * THREE.js のグローバル(THREE)にのみ依存する。立ち位置は持たない(毎フレーム VolleyballGame が置く)。
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
   * 選手のメッシュを id ごとに作る。立ち位置・向きは毎フレーム VolleyballGame が試合の状態から決める。
   * @param {Object} options
   * @param {{near: Array<{id:string, libero?:boolean}>, far: Array<{id:string, libero?:boolean}>}} options.teams
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
      skinColor: 0xe0ac6a
    }, options || {});

    const group = new THREE.Group();
    group.name = 'VolleyballPlayers';
    ['near', 'far'].forEach(side => {
      const teamGroup = new THREE.Group();
      teamGroup.name = 'team-' + side;
      (opt.teams[side] || []).forEach(m => {
        const color = m.libero
          ? (side === 'near' ? opt.liberoNearColor : opt.liberoFarColor)
          : (side === 'near' ? opt.teamNearColor : opt.teamFarColor);
        const mesh = makePlayer(color, opt.skinColor);
        mesh.name = m.id;
        teamGroup.add(mesh);
      });
      group.add(teamGroup);
    });
    return group;
  }

  global.VolleyballPlayers = Object.freeze({
    PLAYER_DIMENSIONS: PLAYER,
    create: create
  });
})(window);
