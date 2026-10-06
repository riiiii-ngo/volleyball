/**
 * VolleyballApp
 * index.html の画面マネージャ。各画面(js/screens/*.js)は register() で自分を登録し、
 * ここが URL ハッシュに応じて1画面だけを生成(mount)・破棄(unmount)する。
 *
 * URL ハッシュの形: #/<画面名>/<引数1>/<引数2>...   例) #/title, #/menu/team, #/practice
 * ハッシュで画面を持つので、ブラウザの「戻る」やリロードでも同じ画面に戻れる。
 *
 * 画面の定義:
 *   VolleyballApp.register('menu', {
 *     mount(el, args, app) { ... return { update(args) {...}, unmount() {...} }; }
 *   });
 *   - el:   この画面専用の要素(class="screen screen-<名前>")。破棄時に要素ごと取り除かれる。
 *   - args: ハッシュの引数(文字列配列)。
 *   - 戻り値の update(args) は、同じ画面のまま引数だけ変わった時(タブ切り替え等)に呼ばれる。
 *     無ければ作り直す。unmount() は画面を離れる直前に呼ばれる(ループ停止やリスナー解除用)。
 *   - hideHeader: true なら画面上部の共通ヘッダー(ユーザ名・ダイヤ・コイン)を出さない(タイトル・試合中など)。
 *
 * 共通ヘッダーは start({ header }) で渡す(js/screens/header.js の VolleyballHeader.create())。
 * 画面が切り替わるたびに表示/非表示を切り替えて中身を読み直す。所持通貨が変わった時は app.refreshHeader() を呼ぶ。
 */
(function (global) {
  'use strict';

  const DEFAULT_SCREEN = 'title';

  const screens = {};
  const scriptPromises = {};
  let root = null;
  let toastEl = null;
  let toastTimer = null;
  let header = null; // { show(visible), refresh() }
  let current = null; // { name, el, instance }

  function register(name, def) {
    screens[name] = def;
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || DEFAULT_SCREEN, args: parts.slice(1) };
  }

  function hashFor(name, args) {
    return '#/' + [name].concat(args || []).map(encodeURIComponent).join('/');
  }

  function render() {
    let route = parseHash();
    if (!screens[route.name]) route = { name: DEFAULT_SCREEN, args: [] };

    if (current && current.name === route.name && current.instance.update) {
      current.instance.update(route.args);
      return;
    }

    if (current) {
      if (current.instance.unmount) current.instance.unmount();
      current.el.remove();
      current = null;
    }

    const showHeader = !!header && !screens[route.name].hideHeader;
    document.body.classList.toggle('has-header', showHeader);
    if (header) {
      header.show(showHeader);
      if (showHeader) header.refresh();
    }

    const el = document.createElement('div');
    el.className = 'screen screen-' + route.name;
    root.appendChild(el);
    const instance = screens[route.name].mount(el, route.args, api) || {};
    current = { name: route.name, el: el, instance: instance };
  }

  /**
   * 画面遷移。
   * @param {string} name - 画面名
   * @param {string[]} [args] - 引数
   * @param {{replace?: boolean}} [opts] - replace:true なら履歴を積まない(タブ切り替え等)
   */
  function go(name, args, opts) {
    const hash = hashFor(name, args);
    if (opts && opts.replace) {
      history.replaceState(null, '', hash);
      render(); // replaceState では hashchange が発火しない
    } else if (location.hash === hash) {
      render();
    } else {
      location.hash = hash; // hashchange → render
    }
  }

  // 外部スクリプトを1回だけ読み込む(2回目以降は同じ Promise を返す)。
  function loadScript(src) {
    if (!scriptPromises[src]) {
      scriptPromises[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          delete scriptPromises[src]; // 次に入った時に再試行できるように
          reject(new Error('スクリプトを読み込めませんでした: ' + src));
        };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[src];
  }

  // 依存順に1つずつ読み込む。
  function loadScripts(list) {
    return list.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  }

  function refreshHeader() {
    if (header) header.refresh();
  }

  function start(options) {
    root = options.root;
    toastEl = options.toast;
    header = options.header || null;
    window.addEventListener('hashchange', render);
    render();
  }

  const api = Object.freeze({ go: go, toast: toast, loadScripts: loadScripts, refreshHeader: refreshHeader });

  global.VolleyballApp = Object.freeze({
    register: register,
    start: start,
    go: go,
    toast: toast,
    loadScripts: loadScripts,
    refreshHeader: refreshHeader
  });
})(window);
