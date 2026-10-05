/**
 * VolleyballCourt モデル
 * バレーボールコートの3Dモデルを生成するモジュール。
 * THREE.js のグローバル(THREE)にのみ依存し、シーン/カメラ/ライト/操作系は含まない。
 * ゲーム側は VolleyballCourt.create() でコートの Group を取得し、
 * 自分の scene に add するだけで良い。
 */
(function (global) {
  'use strict';

  // ---------- 寸法（実寸メートル・国際規格） ----------
  const DIMENSIONS = Object.freeze({
    COURT_W: 9,      // コート幅
    COURT_L: 18,     // コート全長
    SIDE_FREE: 3,    // サイドのフリーゾーン
    END_FREE: 4,     // エンドのフリーゾーン
    NET_TOP: 2.43,   // ネット上端の高さ（男子）
    NET_H: 1.0,      // ネットの縦幅
    POLE_OUT: 0.7,   // ポールがサイドラインから外に出る距離
    POLE_TOP: 2.55,  // ポール上端の高さ
    LINE_W: 0.05,    // ライン幅 5cm
    ATTACK_LINE_DIST: 3 // ネットからアタックラインまでの距離
  });

  // ---------- テクスチャ生成 ----------
  function makeWoodTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b6803f';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 512; i += 16) {
      ctx.fillStyle = (i / 16) % 2 === 0 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(i, 0, 8, 512);
    }
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#5c3d1c' : '#e0ac6a';
      ctx.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 40 + 4, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(
      (DIMENSIONS.COURT_W + DIMENSIONS.SIDE_FREE * 2) / 3,
      (DIMENSIONS.COURT_L + DIMENSIONS.END_FREE * 2) / 3
    );
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeNetTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(15,15,15,0.9)';
    ctx.lineWidth = 2;
    const step = 16;
    for (let i = -128; i < 256; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 128); ctx.lineTo(i + 128, 0); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(
      (DIMENSIONS.COURT_W + DIMENSIONS.POLE_OUT * 2) / 0.5,
      DIMENSIONS.NET_H / 0.5
    );
    return tex;
  }

  function makeAntennaTexture() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 128; i += 16) {
      ctx.fillStyle = (i / 16) % 2 === 0 ? '#e0272e' : '#ffffff';
      ctx.fillRect(0, i, 16, 16);
    }
    return new THREE.CanvasTexture(c);
  }

  // ---------- パーツ生成 ----------
  function buildFloor(d) {
    const group = new THREE.Group();
    group.name = 'floor';

    const freeZoneGeo = new THREE.PlaneGeometry(d.COURT_W + d.SIDE_FREE * 2, d.COURT_L + d.END_FREE * 2);
    const freeZoneMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.85, metalness: 0.03 });
    const freeZone = new THREE.Mesh(freeZoneGeo, freeZoneMat);
    freeZone.rotation.x = -Math.PI / 2;
    freeZone.receiveShadow = true;
    freeZone.name = 'freeZone';
    group.add(freeZone);

    const courtGeo = new THREE.PlaneGeometry(d.COURT_W, d.COURT_L);
    const courtMat = new THREE.MeshStandardMaterial({ color: 0x1a86bd, roughness: 0.55, metalness: 0.05 });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.003;
    court.receiveShadow = true;
    court.name = 'playArea';
    group.add(court);

    return group;
  }

  function buildLines(d) {
    const group = new THREE.Group();
    group.name = 'lines';
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    function addLine(w, depth, x, z) {
      const geo = new THREE.BoxGeometry(w, 0.006, depth);
      const m = new THREE.Mesh(geo, lineMat);
      m.position.set(x, 0.007, z);
      group.add(m);
    }

    addLine(d.LINE_W, d.COURT_L, -d.COURT_W / 2, 0); // サイドライン
    addLine(d.LINE_W, d.COURT_L, d.COURT_W / 2, 0);
    addLine(d.COURT_W, d.LINE_W, 0, -d.COURT_L / 2);  // ベースライン
    addLine(d.COURT_W, d.LINE_W, 0, d.COURT_L / 2);
    addLine(d.COURT_W, d.LINE_W, 0, 0);                // センターライン
    addLine(d.COURT_W, d.LINE_W, 0, d.ATTACK_LINE_DIST);   // アタックライン
    addLine(d.COURT_W, d.LINE_W, 0, -d.ATTACK_LINE_DIST);

    return group;
  }

  function buildNet(d) {
    const group = new THREE.Group();
    group.name = 'net';

    const netMat = new THREE.MeshBasicMaterial({
      map: makeNetTexture(), transparent: true, side: THREE.DoubleSide
    });
    const netMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(d.COURT_W + d.POLE_OUT * 2, d.NET_H),
      netMat
    );
    netMesh.position.set(0, d.NET_TOP - d.NET_H / 2, 0);
    group.add(netMesh);

    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const topTape = new THREE.Mesh(new THREE.BoxGeometry(d.COURT_W + d.POLE_OUT * 2, 0.07, 0.03), tapeMat);
    topTape.position.set(0, d.NET_TOP, 0);
    group.add(topTape);

    const cableMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
    const bottomCable = new THREE.Mesh(new THREE.BoxGeometry(d.COURT_W + d.POLE_OUT * 2, 0.02, 0.02), cableMat);
    bottomCable.position.set(0, d.NET_TOP - d.NET_H, 0);
    group.add(bottomCable);

    return group;
  }

  function buildPoles(d) {
    const group = new THREE.Group();
    group.name = 'poles';
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.35, metalness: 0.6 });

    [-1, 1].forEach(side => {
      const x = side * (d.COURT_W / 2 + d.POLE_OUT);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, d.POLE_TOP, 16), poleMat);
      pole.position.set(x, d.POLE_TOP / 2, 0);
      pole.castShadow = true;
      group.add(pole);
    });

    return group;
  }

  function buildAntennas(d) {
    const group = new THREE.Group();
    group.name = 'antennas';
    const antennaMat = new THREE.MeshBasicMaterial({ map: makeAntennaTexture() });
    const len = 1.8;

    [-1, 1].forEach(side => {
      const x = side * (d.COURT_W / 2);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 8), antennaMat);
      antenna.position.set(x, d.NET_TOP - d.NET_H + len / 2 - 0.1, 0);
      group.add(antenna);
    });

    return group;
  }

  /**
   * コート全体を生成する。
   * @param {Object} [options]
   * @param {Object} [options.dimensions] - DIMENSIONS を上書きしたい場合に指定
   * @returns {THREE.Group} 'VolleyballCourt' という名前の Group（原点=コート中心、ネットは z=0）
   */
  function create(options) {
    const d = Object.assign({}, DIMENSIONS, (options && options.dimensions) || {});

    const court = new THREE.Group();
    court.name = 'VolleyballCourt';
    court.add(buildFloor(d));
    court.add(buildLines(d));
    court.add(buildNet(d));
    court.add(buildPoles(d));
    court.add(buildAntennas(d));

    return court;
  }

  global.VolleyballCourt = Object.freeze({
    DIMENSIONS: DIMENSIONS,
    create: create
  });
})(window);
