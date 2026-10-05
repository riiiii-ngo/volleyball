/**
 * VolleyballBall モデル
 * ボールの見た目（メッシュ）だけを提供するモジュール。
 * 軌道計算やサーブ操作などのゲームロジックは持たない。
 */
(function (global) {
  'use strict';

  const RADIUS = 0.105; // 公式球の半径相当（円周65-67cm）

  function makeBallTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, 256, 128);

    ctx.fillStyle = '#1a86bd';
    ctx.beginPath(); ctx.ellipse(40, 30, 34, 22, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(190, 90, 34, 22, -0.4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#f6c945';
    ctx.beginPath(); ctx.ellipse(150, 25, 30, 18, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(70, 100, 30, 18, 0.3, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(30,30,30,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(192, 0); ctx.lineTo(192, 128); ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /**
   * @returns {THREE.Mesh} 'VolleyballBall' という名前の Mesh（原点=ボール中心）
   */
  function create() {
    const geo = new THREE.SphereGeometry(RADIUS, 24, 16);
    const mat = new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.55 });
    const ball = new THREE.Mesh(geo, mat);
    ball.name = 'VolleyballBall';
    ball.castShadow = true;
    return ball;
  }

  global.VolleyballBall = Object.freeze({
    RADIUS: RADIUS,
    create: create
  });
})(window);
