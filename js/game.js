/**
 * VolleyballGame
 * エントリポイント兼「描画層」。THREE.js のシーン/カメラ/ライト構築、
 * モデル(court/players/ball)の配置、入力(joystick/ボタン)の配線、
 * そして毎フレーム VolleyballSimulation の状態を読んでメッシュに反映する。
 * ゲームルール・状態そのものは持たない(すべて VolleyballSimulation 側)。
 * 画面を離れる時は戻り値の destroy() で描画ループ停止・WebGL 解放・DOM 撤去を行う。
 */
(function (global) {
  'use strict';

  function init(options) {
    const container = options.container;
    const serveBtn = options.serveBtn;
    const joystickParent = options.joystickParent || document.body;
    // 出場チーム(VolleyballData.getTeam() の結果)。members の slot(デッキの枠)で役割とサーブ順が決まる。
    const nearTeam = options.nearTeam;
    const farTeam = options.farTeam;
    // ラリーの勝敗が決まるたびに呼ばれる(result: { winner:'near'|'far', reason }, state: getState() の結果)。
    const onRallyEnd = options.onRallyEnd || null;
    // 得点・セット・試合の終わりが変わるたびに呼ばれる(state)。
    const onScore = options.onScore || null;

    // デッキの枠 → 役割とサーブ順(5-1システム: S→OH1→MB1→OP→OH2→MB2、リベロは別)
    const SLOT_ROLES = {
      se: { role: 'S', order: 0 }, ws1: { role: 'OH', order: 1 }, mb1: { role: 'MB', order: 2 },
      op: { role: 'OP', order: 3 }, ws2: { role: 'OH', order: 4 }, mb2: { role: 'MB', order: 5 },
      li: { role: 'L', order: null }
    };

    // チームの選手を試合用の形にする。ステータスと身長を、試合で使う能力値(速さ・打点等)に変換する。
    function simTeam(team, side) {
      return {
        rotationStart: team.rotationStart || 1,
        members: team.members.filter(m => SLOT_ROLES[m.slot]).map(m => ({
          id: side + '-' + m.slot,
          role: SLOT_ROLES[m.slot].role,
          order: SLOT_ROLES[m.slot].order,
          ability: VolleyballStats.toPlayParams(m.character.stats, m.character.height)
        }))
      };
    }
    const simTeams = { near: simTeam(nearTeam, 'near'), far: simTeam(farTeam, 'far') };

    const d = VolleyballCourt.DIMENSIONS;

    // ---------- 基本セットアップ ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d12);
    scene.fog = new THREE.Fog(0x0a0d12, 18, 46);

    // スマホ縦画面を想定：コート後方から見下ろす固定カメラ
    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 14, 16);
    camera.lookAt(0, 0, -2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    // ---------- ライト ----------
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const key = new THREE.DirectionalLight(0xfff4e0, 1.05);
    key.position.set(6, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0015;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.35);
    fill.position.set(-8, 6, -6);
    scene.add(fill);

    // 天井の照明っぽいポイントライト
    [[-6, 9, 2], [0, 9.5, -2], [6, 9, 2]].forEach(p => {
      const pl = new THREE.PointLight(0xfff2d8, 0.35, 30);
      pl.position.set(p[0], p[1], p[2]);
      scene.add(pl);
    });

    // ---------- コートモデルの読み込み ----------
    const court = VolleyballCourt.create();
    scene.add(court);

    // ---------- 選手モデル（6人+リベロ×2チーム） ----------
    const players = VolleyballPlayers.create({
      teams: {
        near: simTeams.near.members.map(m => ({ id: m.id, libero: m.role === 'L' })),
        far: simTeams.far.members.map(m => ({ id: m.id, libero: m.role === 'L' }))
      }
    });
    scene.add(players);
    const playerMeshes = new Map();
    players.traverse(obj => { if (obj.name && /^(near|far)-/.test(obj.name)) playerMeshes.set(obj.name, obj); });

    // ---------- ボール ----------
    const ball = VolleyballBall.create();
    scene.add(ball);

    // ---------- サーブの狙い位置マーカー ----------
    // マーカー：黒縁+蛍光オレンジの二重リングで、床の色に関わらず視認できるようにする。
    // depthTest を切って常に最前面に描画し、選手やコートに隠れないようにする。
    const targetMarker = new THREE.Group();

    const outline = new THREE.Mesh(
      new THREE.RingGeometry(0.40, 0.50, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85, depthTest: false })
    );
    outline.rotation.x = -Math.PI / 2;
    outline.renderOrder = 998;
    targetMarker.add(outline);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.40, 40),
      new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 1, depthTest: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 999;
    targetMarker.add(ring);

    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthTest: false })
    );
    core.rotation.x = -Math.PI / 2;
    core.renderOrder = 999;
    targetMarker.add(core);

    scene.add(targetMarker);

    // ---------- ジョイスティック ----------
    const joystick = VolleyballJoystick.create({ parent: joystickParent });

    // ---------- 試合ロジック(Simulation) ----------
    const simulation = VolleyballSimulation.create({
      dimensions: d,
      ballRadius: VolleyballBall.RADIUS,
      teams: simTeams,
      controlSide: 'near',
      onEvent: options.onEvent || null
    });

    const onServe = () => simulation.serve();
    serveBtn.addEventListener('click', onServe);

    // ---------- 背景の壁（環境。モデル本体には含めない） ----------
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), wallMat);
    backWall.position.set(0, 10, -(d.COURT_L / 2 + d.END_FREE + 2));
    scene.add(backWall);

    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0x0d1116, roughness: 0.9 });
    [-1, 1].forEach(side => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), sideWallMat);
      w.position.set(side * (d.COURT_W / 2 + d.SIDE_FREE + 8), 10, 0);
      w.rotation.y = -side * Math.PI / 2;
      scene.add(w);
    });

    // ---------- リサイズ ----------
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    // ---------- 描画ループ ----------
    const clock = new THREE.Clock();

    function applyState(state) {
      targetMarker.position.set(state.target.x, 0.05, state.target.z);
      targetMarker.visible = state.targetVisible;

      ball.position.set(state.ball.x, state.ball.y, state.ball.z);
      ball.rotation.x = state.ball.rotX;
      ball.rotation.z = state.ball.rotZ;

      state.players.forEach(p => {
        const mesh = playerMeshes.get(p.id);
        if (!mesh) return;
        mesh.position.set(p.x, p.y, p.z);
        // 向きはなめらかに変える(急に振り向かない)
        let diff = p.yaw - mesh.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        mesh.rotation.y += diff * 0.25;
      });

      serveBtn.disabled = !state.canServe;
      joystick.setZones(state.setChoice ? state.setChoice.zones : null);
      joystick.setActiveZone(state.setChoice ? state.setChoice.active : null);
      joystick.setCaption(state.setChoice ? state.setChoice.quality + 'パス  トスを選ぶ'
        : (state.blockControl ? 'ブロック  左右に動かす' : ''));
    }

    let rafId = 0;
    let lastRallyCount = 0;
    let lastScoreVersion = -1;
    function animate() {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      simulation.update(dt, joystick.value);
      const state = simulation.getState();
      applyState(state);
      if (state.rallyCount !== lastRallyCount) {
        lastRallyCount = state.rallyCount;
        if (onRallyEnd) onRallyEnd(state.lastRally, state);
      }
      if (state.scoreVersion !== lastScoreVersion) {
        lastScoreVersion = state.scoreVersion;
        if (onScore) onScore(state);
      }
      renderer.render(scene, camera);
    }
    animate();

    function destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      serveBtn.removeEventListener('click', onServe);
      joystick.destroy();
      // ジオメトリ/マテリアル/テクスチャを解放(画面を行き来してもGPUメモリが増えないように)
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
        mats.forEach(m => {
          Object.keys(m).forEach(k => { if (m[k] && m[k].isTexture) m[k].dispose(); });
          m.dispose();
        });
      });
      renderer.dispose();
      renderer.domElement.remove();
    }

    return { scene: scene, camera: camera, renderer: renderer, simulation: simulation, destroy: destroy };
  }

  global.VolleyballGame = Object.freeze({ init: init });
})(window);
