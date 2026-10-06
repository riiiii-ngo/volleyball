/**
 * JSON ファイルのデータソース。VolleyballData に 'json' として登録する。
 *   VolleyballData.configure({ source: 'json', baseUrl: 'data/' });
 * マスタは data/*.json(schema/schema.json と同じ形。1ファイル=1テーブルで { version, <テーブル名>: [...] })を読み、
 * VolleyballData が受け取る形(repository.js の先頭のコメント)に変換して返す。
 *   - キャラクター: characters.json。ステータスは Lv1 の値(min_*)を使う。背番号は下のチームのデッキから取る。
 *   - チーム: players / player_characters / party_decks / party_deck_members から、GAME_TEAMS で指定したデッキを組み立てる。
 *   - ガチャ: gachas / gacha_details / items。
 *   - プレイヤー: players のうち PLAYER_ID の行(名前・ダイヤ・コイン)。
 *   - 所持選手: player_characters のうち PLAYER_ID の行(初期の所持選手)。
 *   - アイテム: items / shop_items と、player_items のうち PLAYER_ID の行(初期の所持アイテム)。
 * セーブデータ(レベル・育成・ガチャで獲得した所持選手など)は静的ファイルに書き込めないので、ブラウザの localStorage に保存する
 * (そのブラウザ・端末の中だけに残る。DB に移したらサーバー側に保存される想定)。
 *
 * 注意: ブラウザは file:// で開いたページからの fetch を禁止しているため、
 * ローカルでは http サーバー経由で開く必要がある(例: プロジェクト直下で python -m http.server)。
 */
(function () {
  'use strict';

  const PROGRESS_KEY = 'volleyball.progress.v1';
  const PLAYER_ID = 1; // 操作しているプレイヤー(players.player_id)

  // 試合で使うチーム。どのプレイヤーのどのデッキか、試合の立ち位置(slot)にデッキのどの枠を置くか。
  // 試合はまだ6人制の立ち位置だけなので、使わない枠(MB2 など)は無視する。
  const GAME_TEAMS = [
    {
      id: 'player', name: 'マイチーム', playerId: PLAYER_ID, deckNumber: 1,
      slots: { 'front-1': 'ws1', 'front-2': 'mb1', 'front-3': 'op', 'back-1': 'li', 'back-2': 'ws2', 'server': 'se' }
    },
    {
      id: 'cpu', name: null /* プレイヤー名を使う */, playerId: 2, deckNumber: 1,
      slots: { 'front-1': 'ws1', 'front-2': 'se', 'front-3': 'mb1', 'back-1': 'ws2', 'back-2': 'li', 'back-3': 'op' }
    }
  ];

  VolleyballData.registerSource('json', function createJsonSource(options) {
    const baseUrl = options.baseUrl || 'data/';
    let memoryProgress = null; // localStorage が使えない環境(プライベートモード等)ではメモリにだけ持つ

    function loadJson(file) {
      const url = baseUrl + file;
      return fetch(url, { cache: 'no-cache' }).then(res => {
        if (!res.ok) throw new Error(url + ' を読み込めませんでした (HTTP ' + res.status + ')');
        return res.json();
      }, () => {
        const hint = location.protocol === 'file:'
          ? '。file:// で開いているとデータを読み込めません。http サーバー経由で開いてください(例: python -m http.server)'
          : '';
        throw new Error(url + ' を読み込めませんでした' + hint);
      });
    }

    function loadTable(name) {
      return loadJson(name + '.json').then(json => json[name] || []);
    }

    // GAME_TEAMS のデッキを読み、チームごとに [{ slot, characterId, playerCharacterId, number }] を作る。
    function loadGameTeams() {
      return Promise.all(['players', 'player_characters', 'party_decks', 'party_deck_members'].map(loadTable))
        .then(([players, owned, decks, members]) => GAME_TEAMS.map(t => {
          const deck = decks.find(d => d.player_id === t.playerId && d.deck_number === t.deckNumber);
          const row = deck && members.find(m => m.deck_id === deck.deck_id);
          if (!row) throw new Error('チーム "' + t.id + '" のデッキ(プレイヤー' + t.playerId + ' の ' + t.deckNumber + '番)がありません');
          const player = players.find(p => p.player_id === t.playerId);
          return {
            id: t.id,
            name: t.name || (player ? player.player_name : t.id),
            members: Object.keys(t.slots).map(slot => {
              const key = t.slots[slot];
              const pc = owned.find(o => o.player_character_id === row[key + '_player_character_id']);
              if (!pc) throw new Error('チーム "' + t.id + '" のデッキの ' + key + ' に選手がいません');
              return { slot: slot, characterId: pc.character_id, playerCharacterId: pc.player_character_id, number: row[key + '_uniform_number'] };
            })
          };
        }));
    }

    function toCharacter(row, numbers) {
      return {
        id: row.character_id,
        name: row.name,
        kana: row.kana_name,
        romaji: row.romaji_name,
        rarity: row.rarity,
        position: row.position,
        number: numbers.has(row.character_id) ? numbers.get(row.character_id) : null,
        height: row.height,
        stats: {
          speed: row.min_speed, jump: row.min_jump, power: row.min_power, technique: row.min_technique,
          receive: row.min_receive, block: row.min_block, toss: row.min_toss, serve: row.min_serve
        },
        minStats: {
          spike: row.min_spike, receive: row.min_receive, block: row.min_block, toss: row.min_toss, serve: row.min_serve,
          power: row.min_power, speed: row.min_speed, stamina: row.min_stamina, jump: row.min_jump, technique: row.min_technique
        }
      };
    }

    return {
      loadCharacters() {
        return Promise.all([loadTable('characters'), loadGameTeams()]).then(([rows, teams]) => {
          const numbers = new Map();
          teams.forEach(t => t.members.forEach(m => numbers.set(m.characterId, m.number)));
          return rows.map(row => toCharacter(row, numbers));
        });
      },
      loadTeams() { return loadGameTeams(); },

      loadGachas() {
        return Promise.all(['gachas', 'gacha_details', 'items'].map(loadTable)).then(([gachas, details, items]) => gachas.map(g => {
          const item = items.find(i => i.item_id === g.currency_item_id);
          return {
            id: g.gacha_id,
            name: g.gacha_name,
            startAt: g.start_at,
            endAt: g.end_at,
            currencyType: g.currency_type,
            currencyItemId: g.currency_item_id,
            currencyItemName: item ? item.item_name : '',
            singlePrice: g.single_price,
            multiPrice: g.multi_price,
            rates: details.filter(r => r.gacha_id === g.gacha_id)
              .map(r => ({ characterId: r.character_id, probability: r.probability }))
          };
        }));
      },

      loadItems() {
        return Promise.all(['items', 'shop_items', 'player_items'].map(loadTable)).then(([items, shopItems, owned]) => ({
          items: items.map(i => ({ id: i.item_id, type: i.item_type, name: i.item_name, effectValue: i.effect_value })),
          shopItems: shopItems.map(s => ({
            id: s.shop_item_id,
            itemId: s.item_id,
            quantity: s.quantity,
            currencyType: s.currency_type,
            currencyItemId: s.currency_item_id,
            price: s.price
          })),
          owned: owned.filter(r => r.player_id === PLAYER_ID).map(r => ({ itemId: r.item_id, quantity: r.quantity }))
        }));
      },

      loadPlayer() {
        return loadTable('players').then(rows => {
          const p = rows.find(r => r.player_id === PLAYER_ID);
          if (!p) throw new Error('プレイヤー ' + PLAYER_ID + ' が players にありません');
          return { id: p.player_id, name: p.player_name, paidDiamonds: p.paid_diamonds, freeDiamonds: p.free_diamonds, coins: p.coins };
        });
      },

      loadOwnedCharacters() {
        return loadTable('player_characters').then(rows => ({
          playerId: PLAYER_ID,
          characters: rows.filter(r => r.player_id === PLAYER_ID),
          maxPlayerCharacterId: rows.reduce((max, r) => Math.max(max, r.player_character_id), 0)
        }));
      },

      loadProgress() {
        try {
          const text = localStorage.getItem(PROGRESS_KEY);
          if (text) return Promise.resolve(JSON.parse(text));
        } catch (e) { /* 読めなければ新規扱い */ }
        return Promise.resolve(memoryProgress);
      },

      saveProgress(progress) {
        memoryProgress = progress;
        try {
          localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
        } catch (e) { /* 保存できない環境ではメモリにだけ残る(リロードで消える) */ }
        return Promise.resolve();
      }
    };
  });
})();
