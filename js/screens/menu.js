/**
 * メニュー画面(下部タブ切り替え)。#/menu/<タブID> で表示する。
 * メニューの項目は下の MENU_TABS を書き換えるだけで増減できる。
 */
(function () {
  'use strict';

  // 24x24 の塗りアイコン(fill=currentColor)。
  const ICONS = {
    match: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2c1 0 2 .2 2.9.5-1.6 1.7-2.6 4-2.8 6.5l-6.9-.4A7.8 7.8 0 0 1 12 4.2zm4.9 1.6a7.8 7.8 0 0 1 2.8 7.5c-2.3-1.2-4.9-1.6-7.5-1.2.2-2.4 1.6-4.7 3.7-6.3zM4.4 13c2.4.6 4.6 2 6.1 4l-3.4 2.5A7.8 7.8 0 0 1 4.4 13zm7.6 1.4c2.5-.3 5 .3 7 1.6a7.8 7.8 0 0 1-9.7 3.5l2.7-5.1z"/>',
    team: '<circle cx="8.5" cy="7" r="3.6"/><path d="M1.5 20.5c0-4 3.1-7 7-7s7 3 7 7z"/><circle cx="17" cy="8.2" r="2.8"/><path d="M16.6 13a6 6 0 0 1 5.9 6v1.5h-5c0-3-.3-5.3-.9-7.5z"/>',
    shop: '<path d="M8 7V6a4 4 0 0 1 8 0v1h3.5l-1.3 14.5H5.8L4.5 7zm2 0h4V6a2 2 0 0 0-4 0z"/>',
    social: '<path d="M2 4h13.5v10H8l-4.5 3.5V14H2z"/><path d="M17.5 8H22v10h-1.5v3.5L16 18H9.5v-2h8z"/>',
    other: '<rect x="2.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16.5" y="9.5" width="5" height="5" rx="1"/>'
  };

  // メニュー定義。
  //   screen: タップで遷移する画面名(VolleyballApp に登録された名前)。無ければ「準備中」。
  //   featured: true なら遊べる画面としてオレンジで目立たせる。
  const MENU_TABS = [
    {
      id: 'match', label: '試合', en: 'MATCH', title: '試合モード',
      items: [
        { id: 'practice', label: 'フリー練習', en: 'PRACTICE', screen: 'practice', featured: true },
        { id: 'league', label: 'リーグ戦', en: 'LEAGUE' },
        { id: 'tournament', label: 'トーナメント', en: 'TOURNAMENT' },
        { id: 'friendly', label: '親善試合', en: 'FRIENDLY' },
        { id: 'online', label: 'オンライン対戦', en: 'ONLINE' }
      ]
    },
    {
      id: 'team', label: 'チーム', en: 'TEAM', title: 'チーム',
      items: [
        // スタメン設定でフォーメーション(ポジション配置)もまとめて決める
        { id: 'lineup', label: 'スタメン設定', en: 'LINEUP' },
        { id: 'roster', label: '選手一覧', en: 'ROSTER', screen: 'roster' },
        { id: 'training', label: '選手育成', en: 'TRAINING', screen: 'training' }
      ]
    },
    {
      id: 'shop', label: 'ショップ', en: 'SHOP', title: 'ショップ',
      items: [
        { id: 'gacha', label: 'ガチャ', en: 'GACHA', screen: 'gacha', featured: true },
        { id: 'items', label: 'アイテム', en: 'ITEMS', screen: 'shop' },
        { id: 'uniform', label: 'ユニフォーム', en: 'UNIFORM' }
      ]
    },
    {
      id: 'social', label: '社交', en: 'SOCIAL', title: '社交',
      items: [
        { id: 'friends', label: 'フレンド', en: 'FRIENDS' },
        { id: 'ranking', label: 'ランキング', en: 'RANKING' },
        { id: 'club', label: 'クラブ', en: 'CLUB' }
      ]
    },
    {
      id: 'other', label: 'その他', en: 'OTHERS', title: 'その他',
      items: [
        { id: 'settings', label: '設定', en: 'SETTINGS' },
        { id: 'news', label: 'お知らせ', en: 'NEWS' },
        { id: 'help', label: 'ヘルプ', en: 'HELP' },
        { id: 'title', label: 'タイトルへ', en: 'TITLE', screen: 'title' }
      ]
    }
  ];

  function svg(name, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  VolleyballApp.register('menu', {
    mount(el, args, app) {
      el.classList.add('menu-screen');
      el.innerHTML =
        '<header class="menu-header"><h1 class="menu-heading"></h1></header>' +
        '<main class="menu-content"><ul class="menu-list"></ul></main>' +
        '<nav class="menu-tabbar" role="tablist" aria-label="メインメニュー"></nav>';

      const heading = el.querySelector('.menu-heading');
      const content = el.querySelector('.menu-content');
      const list = el.querySelector('.menu-list');
      const tabbar = el.querySelector('.menu-tabbar');
      let currentTab = null;

      // ---------- タブバー ----------
      MENU_TABS.forEach(tab => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tab-btn';
        btn.setAttribute('role', 'tab');
        btn.dataset.tab = tab.id;
        btn.innerHTML = '<span class="tab-bg"></span>' + svg(tab.id, 'tab-icon') + '<span class="tab-label">' + tab.label + '</span>';
        // タブ切り替えは履歴を積まない(戻るボタンでタブを遡らない)
        btn.addEventListener('click', () => app.go('menu', [tab.id], { replace: true }));
        tabbar.appendChild(btn);
      });

      function selectTab(tabId) {
        const tab = MENU_TABS.find(t => t.id === tabId) || MENU_TABS[0];
        if (tab.id === currentTab) return;
        currentTab = tab.id;
        renderItems(tab);
        tabbar.querySelectorAll('.tab-btn').forEach(b => {
          const active = b.dataset.tab === tab.id;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      }

      // ---------- 項目リスト ----------
      function renderItems(tab) {
        heading.innerHTML = '<span class="menu-heading-en">' + tab.en + '</span>' +
          '<span class="menu-heading-ja">' + tab.title + '</span>';
        list.innerHTML = '';
        tab.items.forEach((item, i) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'menu-item' +
            (item.featured ? ' is-featured' : '') +
            (item.screen ? '' : ' is-locked');
          btn.style.animationDelay = (i * 50) + 'ms';
          btn.innerHTML =
            '<span class="menu-item-en" aria-hidden="true">' + item.en + '</span>' +
            '<span class="menu-item-no">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="menu-item-label">' + item.label + '</span>' +
            (item.screen ? '' : '<span class="menu-item-lock">準備中</span>');
          btn.addEventListener('click', () => {
            if (item.screen) app.go(item.screen);
            else app.toast(item.label + 'は準備中です');
          });
          li.appendChild(btn);
          list.appendChild(li);
        });
        content.scrollTop = 0;
      }

      selectTab(args[0]);

      return {
        update(newArgs) { selectTab(newArgs[0]); }
      };
    }
  });
})();
