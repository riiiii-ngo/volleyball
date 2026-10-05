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
    const receiveBtn = options.receiveBtn;
    const joystickParent = options.joystickParent || document.body;
    // 出場チーム(VolleyballData.getTeam() の結果)。members の slot で3Dモデルの立ち位置と対応させる。
    const nearTeam = options.nearTeam;
    const farTeam = options.farTeam;
    // ラリーの勝敗が決まるたびに呼ばれる({ winner:'near'|'far', reason:'in'|'out'|'net' })。
    const onRallyEnd = options.onRallyEnd || null;

    // スロットに入っているキャラクターのステータスを、試合で使う能力値(速さ等)に変換する。
    // スロットが空ならステータス標準値(50)の選手として扱う。
    function abilityOf(team, slot) {
      const member = team && team.members.find(m => m.slot === slot);
      return VolleyballStats.toPlayParams(member ? member.character.stats : null);
    }

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

    // ---------- 選手モデルの読み込み（6人×2チーム） ----------
    const players = VolleyballPlayers.create();
    scene.add(players);

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
    const server = players.getObjectByName('near-server'); // 後衛ライト＝セッター固定
    const leftAttacker = players.getObjectByName('near-front-1');
    const centerAttacker = players.getObjectByName('near-front-2'); // センター攻撃者とブロッカーを兼任
    const rightAttacker = players.getObjectByName('near-front-3');
    const nearBack1 = players.getObjectByName('near-back-1');
    const nearBack2 = players.getObjectByName('near-back-2');

    // 相手チーム6人。ブロックはセンター(far-front-2)と、こちらの攻撃側の前衛(far-front-1/3)が跳ぶ。
    // レシーブはこの6人の中から、落下点に最も近い選手をSimulation側で毎回自動選出する。
    // 速さ等の能力は各スロットのキャラクターのステータスから決まる(abilityOf)。
    const FAR_PLAYER_ROSTER = [
      { name: 'far-front-1', slot: 'front-1' },
      { name: 'far-front-2', slot: 'front-2' },
      { name: 'far-front-3', slot: 'front-3' },
      { name: 'far-back-1', slot: 'back-1' },
      { name: 'far-back-2', slot: 'back-2' },
      { name: 'far-back-3', slot: 'back-3' }
    ];
    const farPlayerObjs = FAR_PLAYER_ROSTER.map(p => players.getObjectByName(p.name));
    const nearBack1Ability = abilityOf(nearTeam, 'back-1');
    const nearBack2Ability = abilityOf(nearTeam, 'back-2');

    const simulation = VolleyballSimulation.create({
      dimensions: d,
      ballRadius: VolleyballBall.RADIUS,
      serverPos: { x: server.position.x, z: server.position.z },
      leftAttackerPos: { x: leftAttacker.position.x, z: leftAttacker.position.z },
      centerAttackerPos: { x: centerAttacker.position.x, z: centerAttacker.position.z },
      rightAttackerPos: { x: rightAttacker.position.x, z: rightAttacker.position.z },
      attackers: {
        left: abilityOf(nearTeam, 'front-1'),
        center: abilityOf(nearTeam, 'front-2'),
        right: abilityOf(nearTeam, 'front-3')
      },
      serveTime: abilityOf(nearTeam, 'server').serveTime,
      serveError: abilityOf(nearTeam, 'server').serveError,
      // サーバーがセッターを兼任。サーブ後は後衛ライト(後衛と同じ深さ)に入って守る
      setter: abilityOf(nearTeam, 'server'),
      setterCourtPos: { x: server.position.x, z: nearBack1.position.z },
      nearReceivers: [
        { name: 'near-back-1', pos: { x: nearBack1.position.x, z: nearBack1.position.z },
          speed: nearBack1Ability.speed, reach: nearBack1Ability.reach,
          passError: nearBack1Ability.passError, tossError: nearBack1Ability.tossError },
        { name: 'near-back-2', pos: { x: nearBack2.position.x, z: nearBack2.position.z },
          speed: nearBack2Ability.speed, reach: nearBack2Ability.reach,
          passError: nearBack2Ability.passError, tossError: nearBack2Ability.tossError }
      ],
      farPlayers: farPlayerObjs.map((obj, i) => {
        const ability = abilityOf(farTeam, FAR_PLAYER_ROSTER[i].slot);
        return {
          name: FAR_PLAYER_ROSTER[i].name,
          pos: { x: obj.position.x, z: obj.position.z },
          speed: ability.speed,
          reach: ability.reach,
          jumpHeight: ability.jumpHeight,
          spikeTime: ability.spikeTime,
          spikeError: ability.spikeError,
          passError: ability.passError,
          tossError: ability.tossError,
          blockReach: ability.blockReach,
          blockPower: ability.blockPower,
          attackPower: ability.attackPower
        };
      })
    });

    const onServe = () => simulation.serve();
    const onReceive = () => simulation.receive();
    serveBtn.addEventListener('click', onServe);
    receiveBtn.addEventListener('click', onReceive);

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

      leftAttacker.position.set(state.leftAttacker.x, state.leftAttacker.y, state.leftAttacker.z);
      centerAttacker.position.set(state.centerAttacker.x, state.centerAttacker.y, state.centerAttacker.z);
      rightAttacker.position.set(state.rightAttacker.x, state.rightAttacker.y, state.rightAttacker.z);
      server.position.set(state.nearSetter.x, state.nearSetter.y, state.nearSetter.z);
      nearBack1.position.set(state.nearReceivers[0].x, state.nearReceivers[0].y, state.nearReceivers[0].z);
      nearBack2.position.set(state.nearReceivers[1].x, state.nearReceivers[1].y, state.nearReceivers[1].z);

      farPlayerObjs.forEach((obj, i) => {
        const p = state.farPlayers[i];
        obj.position.set(p.x, p.y, p.z);
      });

      serveBtn.disabled = !state.canServe;
      receiveBtn.disabled = !state.canReceive;
      joystick.setActiveZone(state.tossZone);
    }

    let rafId = 0;
    let lastRallyCount = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      simulation.update(dt, joystick.value);
      const state = simulation.getState();
      applyState(state);
      if (state.rallyCount !== lastRallyCount) {
        lastRallyCount = state.rallyCount;
        if (onRallyEnd) onRallyEnd(state.lastRally);
      }
      renderer.render(scene, camera);
    }
    animate();

    function destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      serveBtn.removeEventListener('click', onServe);
      receiveBtn.removeEventListener('click', onReceive);
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
