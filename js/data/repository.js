/**
 * VolleyballData
 * キャラクター・チームのデータ取得/保存の窓口。ゲーム側(画面・試合)は必ずここを通して読み書きし、
 * データが JSON ファイルにあるか DB にあるかを意識しない。
 *
 * データは2種類:
 *   - マスタ(初期値): キャラクターの基本ステータス、チーム編成、初期の所持選手・所持アイテム。ゲーム側からは書き換えない。
 *   - セーブ(進行状況): 所持選手1体(player_character_id)ごとのレベル・経験値・育成ポイント・割り振ったステータスと、
 *     ガチャで獲得した所持選手(player_characters テーブルと同じ形の行)、ショップで買った・使ったアイテムの所持数。
 *   画面に渡す選手は、所持選手の行のステータスにセーブの割り振り分を足したもの。
 *   同じ選手を2体持っていても、レベル・育成は1体ずつ別に持つ。
 *
 * 保存先の切り替え:
 *   実際の読み書きは「ソース」が担当する。ソースは registerSource() で名前付きで登録し、
 *   configure({ source: '<名前>', ...オプション }) で使うものを選ぶ(index.html で1回だけ呼ぶ)。
 *     - 'json' : マスタは data/*.json、セーブはブラウザの localStorage(js/data/json-source.js)。
 *     - 将来 DB に移す時は、ブラウザから DB へは直接つながないので、サーバーの API を叩く
 *       ソース(例: 'api')を js/data/ に作って登録し、configure の source を差し替えるだけでよい。
 *
 * ソースが実装するメソッド(すべて Promise を返す):
 *   loadCharacters()        → Array<{ id, name, kana?, romaji?, rarity?, level?, position, number?, height?, stats,
 *                                     minStats? }>   stats は試合用8項目、minStats は ALL_STATS の Lv1 の値
 *   loadTeams()             → Array<{ id, name, members: Array<{ slot, characterId, playerCharacterId?, number? }> }>
 *                               playerCharacterId はその枠の所持選手(player_characters)の ID
 *   loadGachas()            → Array<{ id, name, startAt, endAt|null, currencyType, currencyItemId|null, currencyItemName?,
 *                                     singlePrice, multiPrice, rates: Array<{ characterId, probability(%) }> }>
 *   loadPlayer()            → { id, name, paidDiamonds, freeDiamonds, coins }   操作しているプレイヤー
 *   loadOwnedCharacters()   → { playerId, characters: Array<player_characters の行>, maxPlayerCharacterId?,
 *                               deckPlayerCharacterIds? }
 *                               初期の所持選手。maxPlayerCharacterId は全プレイヤーの行の最大ID(新しい行の採番用)、
 *                               deckPlayerCharacterIds は自分のデッキ(全デッキ・全枠)に置かれている所持選手のID(売却できない)
 *   loadItems()             → { items: Array<{ id, type, name, effectValue|null }>,
 *                               shopItems: Array<{ id, itemId, quantity, currencyType, currencyItemId|null, price }>,
 *                               owned: Array<{ itemId, quantity }> }   owned は初期の所持アイテム
 *   loadProgress()          → { owned: { [player_character_id]: { level, exp, points, bonus: { [stat]: n } } },
 *                               ownedCharacters?: Array<player_characters の行>,
 *                               sold?: Array<player_character_id>,
 *                               items?: { [itemId]: 所持数 } } | null   items は所持数が変わったアイテムだけ、
 *                               sold は売却した所持選手(初期の所持選手も含む)のID
 *                               (以前のセーブの characters: { [キャラID]: ... } は、自チームのその選手の分として読み替える)
 *   saveProgress(progress)  → 保存完了で resolve
 *   保存先の形(data/*.json や DB のテーブル)からこの形への変換はソースが行う(例: js/data/json-source.js)。
 *   欠けた値や範囲外の値はここで補正するので、ソース側は保存されている値をそのまま返せばよい。
 */
(function (global) {
  'use strict';

  // ステータス項目(表示順)。値は 1〜99、未設定は 50。
  const STATS = Object.freeze([
    { key: 'speed', label: 'スピード' },
    { key: 'jump', label: 'ジャンプ' },
    { key: 'power', label: 'パワー' },
    { key: 'technique', label: 'テクニック' },
    { key: 'receive', label: 'レシーブ' },
    { key: 'block', label: 'ブロック' },
    { key: 'toss', label: 'トス' },
    { key: 'serve', label: 'サーブ' }
  ]);
  const STAT_MIN = 1;
  const STAT_MAX = 99;
  const STAT_DEFAULT = 50;

  // 選手マスタ・所持選手が持つ全ステータス(表示順)。試合で使うのは STATS の8項目だけ。
  const ALL_STATS = Object.freeze([
    { key: 'spike', label: 'スパイク' },
    { key: 'receive', label: 'レシーブ' },
    { key: 'block', label: 'ブロック' },
    { key: 'toss', label: 'トス' },
    { key: 'serve', label: 'サーブ' },
    { key: 'power', label: 'パワー' },
    { key: 'speed', label: 'スピード' },
    { key: 'stamina', label: 'スタミナ' },
    { key: 'jump', label: 'ジャンプ' },
    { key: 'technique', label: 'テクニック' }
  ]);

  // ガチャの支払い方法(schema の currency_type)の表示名。item はアイテム名を使う。
  const CURRENCY_LABELS = Object.freeze({
    free: '無料',
    diamond: 'ダイヤ',
    paid_diamond: '有償ダイヤ',
    coin: 'コイン',
    item: 'アイテム'
  });
  const GACHA_COUNTS = Object.freeze([1, 10]); // 単発 / 10連

  // 選手を売却した時にもらえるアイテム(レア度 → 経験値チケットLv1の枚数)
  const SELL_REWARD_ITEM_ID = 'i_exp_ticket_1';
  const SELL_REWARD_COUNTS = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 });

  // アイテム種別(schema の item_type)の表示名
  const ITEM_TYPE_LABELS = Object.freeze({
    coin: 'コイン',
    token: 'トークン',
    gacha_ticket: 'ガチャチケット',
    exp_ticket: '経験値チケット'
  });

  const POSITIONS = Object.freeze({
    WS: 'ウイングスパイカー',
    MB: 'ミドルブロッカー',
    OP: 'オポジット',
    SE: 'セッター',
    LI: 'リベロ'
  });

  const sourceFactories = {};
  let source = null;
  // Promise<{ master: Map<id, 基本データ>, teams: Array<チーム(生データ)>, progress: セーブデータ }>
  let cache = null;
  let saveQueue = Promise.resolve();

  function registerSource(name, factory) {
    sourceFactories[name] = factory;
  }

  function configure(options) {
    const factory = sourceFactories[options.source];
    if (!factory) throw new Error('データソース "' + options.source + '" は登録されていません');
    source = factory(options);
    cache = null;
  }

  function clampStat(v) {
    return Math.round(Math.min(STAT_MAX, Math.max(STAT_MIN, v)));
  }

  function normalizeMaster(raw) {
    if (!raw || !raw.id) throw new Error('id の無いキャラクターがあります');
    const stats = {};
    STATS.forEach(s => {
      const v = Number(raw.stats && raw.stats[s.key]);
      stats[s.key] = Number.isFinite(v) ? clampStat(v) : STAT_DEFAULT;
    });
    const level = Math.max(1, Math.min(VolleyballProgression.MAX_LEVEL, Math.round(Number(raw.level) || 1)));
    // Lv1 の全ステータス(ガチャで獲得した時の初期値)。無ければ試合用の値 → 既定値の順で埋める。
    const minStats = {};
    ALL_STATS.forEach(s => {
      const v = Number(raw.minStats && raw.minStats[s.key]);
      minStats[s.key] = Number.isFinite(v) ? clampStat(v) : (stats[s.key] != null ? stats[s.key] : STAT_DEFAULT);
    });
    return Object.freeze({
      id: String(raw.id),
      name: raw.name || raw.id,
      kana: raw.kana || '',
      romaji: raw.romaji || '',
      rarity: Math.max(1, Math.min(5, Math.round(Number(raw.rarity) || 1))),
      minStats: Object.freeze(minStats),
      level: level,
      position: POSITIONS[raw.position] ? raw.position : 'WS',
      number: raw.number != null ? raw.number : null,
      height: raw.height != null ? raw.height : null,
      stats: Object.freeze(stats)
    });
  }

  // 操作中のプレイヤーの所持選手の行(初期の所持選手 + ガチャで獲得した選手)。
  function ownedRows(d) {
    const sold = new Set(d.progress.sold);
    return d.initialOwned.concat(d.progress.ownedCharacters)
      .filter(r => r.player_id === d.playerId && !sold.has(r.player_character_id));
  }

  function ownedRow(d, playerCharacterId) {
    const id = Number(playerCharacterId);
    return ownedRows(d).find(r => r.player_character_id === id) || null;
  }

  // 所持選手1体の進行状況(無ければ行のレベル・経験値から作る)。
  function progressOf(d, row) {
    let p = d.progress.owned[row.player_character_id];
    if (!p) {
      p = { level: row.level, exp: row.exp, points: 0, bonus: {} };
      d.progress.owned[row.player_character_id] = p;
    }
    return p;
  }

  // 自チーム('player')での立ち位置と背番号。入っていなければ null。
  function teamOf(d, playerCharacterId) {
    const team = d.teams.find(t => String(t.id) === 'player');
    const m = team && (team.members || []).find(x => Number(x.playerCharacterId) === playerCharacterId);
    return m ? Object.freeze({ slot: m.slot, number: m.number != null ? m.number : null }) : null;
  }

  // 画面・試合に渡す選手。所持選手は行のステータス + セーブの割り振り分、
  // 所持していない選手(相手チーム)はマスタの Lv1 の値で作る。
  //   stats/baseStats/bonus は試合用の8項目(STATS)、allStats は全10項目(ALL_STATS)。
  function buildUnit(d, row, master, team) {
    const p = row ? progressOf(d, row) : { level: master.level, exp: 0, points: 0, bonus: {} };
    const baseStats = {};
    const bonus = {};
    const stats = {};
    const allStats = {};
    ALL_STATS.forEach(s => {
      const base = row ? clampStat(row[s.key]) : master.minStats[s.key];
      allStats[s.key] = Math.min(STAT_MAX, base + (p.bonus[s.key] || 0));
    });
    STATS.forEach(s => {
      baseStats[s.key] = row ? clampStat(row[s.key]) : master.stats[s.key];
      bonus[s.key] = p.bonus[s.key] || 0;
      stats[s.key] = Math.min(STAT_MAX, baseStats[s.key] + bonus[s.key]);
    });
    return Object.freeze({
      playerCharacterId: row ? row.player_character_id : null,
      id: master.id,
      name: master.name,
      kana: master.kana,
      romaji: master.romaji,
      rarity: master.rarity,
      position: master.position,
      height: master.height,
      number: team && team.number != null ? team.number : null,
      team: team || null,
      level: p.level,
      exp: p.exp,
      expToNext: VolleyballProgression.expToNext(p.level),
      points: p.points,
      baseStats: Object.freeze(baseStats),
      bonus: Object.freeze(bonus),
      stats: Object.freeze(stats),
      allStats: Object.freeze(allStats)
    });
  }

  // 所持選手(buildUnit に売却の情報を足したもの)。
  //   inDeck: デッキに置かれている(売却できない)、sellReward: 売却でもらえるアイテムと個数
  function buildOwned(d, row) {
    const unit = buildUnit(d, row, d.master.get(row.character_id), teamOf(d, row.player_character_id));
    const reward = sellRewardOf(d, unit.rarity);
    return Object.freeze(Object.assign({}, unit, {
      inDeck: d.deckIds.has(row.player_character_id),
      sellReward: reward ? Object.freeze({ itemId: reward.item.id, itemName: reward.item.name, count: reward.count }) : null
    }));
  }

  function sellRewardOf(d, rarity) {
    const item = d.itemMaster.get(SELL_REWARD_ITEM_ID);
    const count = SELL_REWARD_COUNTS[rarity] || 0;
    return item && count > 0 ? { item: item, count: count } : null;
  }

  // セーブの進行状況1件の補正。割り振り分は行のステータスと合わせて99を超えないようにする。
  function normalizeUnitProgress(c, row) {
    c = c || {};
    const bonus = {};
    STATS.forEach(s => {
      const v = Math.round(Number(c.bonus && c.bonus[s.key]) || 0);
      if (v > 0) bonus[s.key] = Math.min(v, Math.max(0, STAT_MAX - clampStat(row[s.key])));
    });
    return {
      level: Math.max(1, Math.min(VolleyballProgression.MAX_LEVEL, Math.round(Number(c.level) || 1))),
      exp: Math.max(0, Math.round(Number(c.exp) || 0)),
      points: Math.max(0, Math.round(Number(c.points) || 0)),
      bonus: bonus
    };
  }

  // セーブデータの読み込み時補正(壊れた値・マスタや所持選手に無いものは無視する)。
  function normalizeProgress(raw, ctx) {
    const out = {};
    // ガチャで獲得した所持選手(壊れた行・マスタに無い選手は捨てる)
    out.ownedCharacters = ((raw && raw.ownedCharacters) || [])
      .map(row => normalizeOwnedRow(row, ctx.master))
      .filter(Boolean);
    // 売却した所持選手のID(デッキに入っている選手は売れないので無視する)
    out.sold = Array.from(new Set(((raw && raw.sold) || []).map(id => Math.round(Number(id)))))
      .filter(id => id >= 1 && !ctx.deckIds.has(id));
    const sold = new Set(out.sold);
    const rows = new Map();
    ctx.initialOwned.concat(out.ownedCharacters)
      .filter(r => r.player_id === ctx.playerId && !sold.has(r.player_character_id))
      .forEach(r => rows.set(r.player_character_id, r));

    out.owned = {};
    const owned = (raw && raw.owned) || {};
    Object.keys(owned).forEach(id => {
      const row = rows.get(Number(id));
      if (row) out.owned[row.player_character_id] = normalizeUnitProgress(owned[id], row);
    });
    // 以前のセーブ(キャラID単位)は、自チームでその選手を使っている所持選手の分として引き継ぐ
    const legacy = (raw && raw.characters) || {};
    const team = ctx.teams.find(t => String(t.id) === 'player');
    Object.keys(legacy).forEach(charId => {
      const m = team && (team.members || []).find(x => String(x.characterId) === charId);
      const row = m && rows.get(Number(m.playerCharacterId));
      if (row && !out.owned[row.player_character_id]) {
        out.owned[row.player_character_id] = normalizeUnitProgress(legacy[charId], row);
      }
    });

    // ショップで買った・使ったアイテムの所持数(アイテムマスタに無いものは捨てる)
    out.items = {};
    const items = (raw && raw.items) || {};
    Object.keys(items).forEach(id => {
      if (ctx.itemMaster.has(id)) out.items[id] = Math.max(0, Math.round(Number(items[id]) || 0));
    });
    return out;
  }

  // 所持選手の行(player_characters テーブルの形)の補正。使えない行は null。
  function normalizeOwnedRow(row, master) {
    if (!row || !master.has(String(row.character_id))) return null;
    const id = Math.round(Number(row.player_character_id));
    if (!(id >= 1)) return null;
    const out = {
      player_character_id: id,
      player_id: Math.round(Number(row.player_id)) || 0,
      character_id: String(row.character_id),
      level: Math.max(1, Math.min(VolleyballProgression.MAX_LEVEL, Math.round(Number(row.level) || 1))),
      exp: Math.max(0, Math.round(Number(row.exp) || 0))
    };
    ALL_STATS.forEach(s => {
      const v = Number(row[s.key]);
      out[s.key] = Number.isFinite(v) ? Math.max(0, Math.round(v)) : master.get(out.character_id).minStats[s.key];
    });
    return out;
  }

  function normalizeGacha(raw, master) {
    const startAt = Date.parse(raw.startAt);
    const endAt = raw.endAt == null ? null : Date.parse(raw.endAt);
    if (!raw.id || !Number.isFinite(startAt) || Number.isNaN(endAt)) {
      throw new Error('ガチャ "' + raw.id + '" の期間が読めません');
    }
    const rates = (raw.rates || []).map(r => {
      if (!master.has(String(r.characterId))) {
        throw new Error('ガチャ "' + raw.id + '" に存在しないキャラクター "' + r.characterId + '" が指定されています');
      }
      return { characterId: String(r.characterId), probability: Math.max(0, Number(r.probability) || 0) };
    });
    return {
      id: String(raw.id),
      name: raw.name || raw.id,
      startAt: startAt,
      endAt: endAt,
      currencyType: raw.currencyType,
      currencyItemName: raw.currencyItemName || '',
      singlePrice: Math.max(0, Math.round(Number(raw.singlePrice) || 0)),
      multiPrice: Math.max(0, Math.round(Number(raw.multiPrice) || 0)),
      rates: rates
    };
  }

  // アイテムマスタ・ショップ商品・初期の所持アイテムの補正。
  function normalizeItems(raw) {
    const master = new Map();
    (raw.items || []).forEach(i => {
      if (!i || !i.id) throw new Error('id の無いアイテムがあります');
      const effect = Math.round(Number(i.effectValue));
      master.set(String(i.id), Object.freeze({
        id: String(i.id),
        type: i.type,
        name: i.name || i.id,
        effectValue: effect >= 1 ? effect : null
      }));
    });
    master.forEach(i => {
      if (i.type === 'exp_ticket' && i.effectValue == null) throw new Error('経験値チケット "' + i.id + '" に効果量がありません');
    });
    const shopItems = (raw.shopItems || []).map(s => {
      if (!master.has(String(s.itemId))) throw new Error('ショップ商品 "' + s.id + '" に存在しないアイテム "' + s.itemId + '" が指定されています');
      return Object.freeze({
        id: String(s.id),
        itemId: String(s.itemId),
        quantity: Math.max(1, Math.round(Number(s.quantity) || 1)),
        currencyType: s.currencyType,
        currencyItemId: s.currencyItemId == null ? null : String(s.currencyItemId),
        price: Math.max(0, Math.round(Number(s.price) || 0))
      });
    });
    const owned = {};
    (raw.owned || []).forEach(r => {
      if (master.has(String(r.itemId))) owned[String(r.itemId)] = Math.max(0, Math.round(Number(r.quantity) || 0));
    });
    return { master: master, shopItems: shopItems, owned: owned };
  }

  function toAmount(v) {
    return Math.max(0, Math.round(Number(v) || 0));
  }

  // プレイヤー(名前・所持通貨)の補正。
  function normalizePlayer(raw) {
    if (!raw) throw new Error('プレイヤーのデータがありません');
    return Object.freeze({
      id: raw.id,
      name: String(raw.name || 'プレイヤー'),
      paidDiamonds: toAmount(raw.paidDiamonds),
      freeDiamonds: toAmount(raw.freeDiamonds),
      coins: toAmount(raw.coins)
    });
  }

  function load() {
    if (!source) throw new Error('VolleyballData.configure() が呼ばれていません');
    if (!cache) {
      cache = Promise.all([
        source.loadCharacters(), source.loadTeams(), source.loadProgress(), source.loadGachas(), source.loadOwnedCharacters(),
        source.loadItems(), source.loadPlayer()
      ])
        .then(([rawChars, rawTeams, rawProgress, rawGachas, rawOwned, rawItems, rawPlayer]) => {
          const master = new Map();
          rawChars.forEach(raw => {
            const c = normalizeMaster(raw);
            if (master.has(c.id)) throw new Error('キャラクターID "' + c.id + '" が重複しています');
            master.set(c.id, c);
          });
          // チームの中のキャラクターIDは読み込み時に確認しておく(データの誤りを早く見つけるため)
          rawTeams.forEach(t => (t.members || []).forEach(m => {
            if (!master.has(String(m.characterId))) {
              throw new Error('チーム "' + t.id + '" の ' + m.slot + ' に存在しないキャラクター "' + m.characterId + '" が指定されています');
            }
          }));
          const items = normalizeItems(rawItems);
          // 初期の所持選手(マスタ側。ゲームからは書き換えない)。獲得分は progress.ownedCharacters
          const initialOwned = (rawOwned.characters || []).map(row => normalizeOwnedRow(row, master)).filter(Boolean);
          const playerId = rawOwned.playerId;
          const deckIds = new Set((rawOwned.deckPlayerCharacterIds || []).map(Number));
          return {
            master: master,
            teams: rawTeams,
            progress: normalizeProgress(rawProgress, {
              master: master, itemMaster: items.master, initialOwned: initialOwned, playerId: playerId, teams: rawTeams,
              deckIds: deckIds
            }),
            deckIds: deckIds,
            itemMaster: items.master,
            shopItems: items.shopItems,
            // 初期の所持アイテム { [itemId]: 所持数 }(マスタ側。変わった分は progress.items)
            initialItems: items.owned,
            gachas: rawGachas.map(g => normalizeGacha(g, master)),
            playerId: playerId,
            player: normalizePlayer(rawPlayer),
            initialOwned: initialOwned,
            // 新しい所持選手の採番用(他のプレイヤーの行とIDが重ならないように)
            maxPlayerCharacterId: Math.max(0, Math.round(Number(rawOwned.maxPlayerCharacterId)) || 0)
          };
        });
      cache.catch(() => { cache = null; }); // 失敗したら次回やり直せるように
    }
    return cache;
  }

  // セーブは順番に1つずつ行う(連続で呼ばれても古い内容で上書きしないように)。
  function save(data) {
    const snapshot = JSON.parse(JSON.stringify(data.progress));
    saveQueue = saveQueue.then(() => source.saveProgress(snapshot));
    return saveQueue;
  }

  /**
   * チーム。members の character は buildUnit() の形。
   * 自チーム('player')の選手は所持選手(レベル・育成を反映)、相手チームはマスタの値。
   */
  function getTeam(id) {
    return load().then(d => {
      const raw = d.teams.find(t => String(t.id) === String(id));
      if (!raw) throw new Error('チーム "' + id + '" が見つかりません');
      const isPlayer = String(raw.id) === 'player';
      return Object.freeze({
        id: String(raw.id),
        name: raw.name || raw.id,
        members: Object.freeze((raw.members || []).map(m => {
          const row = isPlayer ? ownedRow(d, m.playerCharacterId) : null;
          if (isPlayer && !row) throw new Error('チーム "' + raw.id + '" の ' + m.slot + ' の所持選手が見つかりません');
          const team = Object.freeze({ slot: m.slot, number: m.number != null ? m.number : null });
          return Object.freeze({
            slot: m.slot,
            character: buildUnit(d, row, d.master.get(String(m.characterId)), team)
          });
        }))
      });
    });
  }

  function requireOwned(d, playerCharacterId) {
    const row = ownedRow(d, playerCharacterId);
    if (!row) throw new Error('所持選手 "' + playerCharacterId + '" が見つかりません');
    return row;
  }

  // セーブ上の経験値を増やす(保存はしない)。経験値が入るのは経験値チケットを使った時だけ。
  function grantExp(d, row, amount) {
    const p = progressOf(d, row);
    const r = VolleyballProgression.addExp(p, amount);
    p.level = r.level;
    p.exp = r.exp;
    p.points = r.points;
    return { row: row, levelsGained: r.levelsGained, pointsGained: r.pointsGained };
  }

  function expResult(d, r) {
    return { character: buildOwned(d, r.row), levelsGained: r.levelsGained, pointsGained: r.pointsGained };
  }

  /**
   * 育成ポイントをステータスに割り振る。上げるのに使うポイントは、そのステータスを育成で上げた回数に応じて
   * 段階的に増える(VolleyballProgression.statUpCost)。
   * @param {number} playerCharacterId - 所持選手ID
   * @param {Object<string, number>} allocation - 例 { speed: 2, receive: 1 }(上げる量)
   * @returns {Promise<character>} 割り振り後の選手
   */
  function allocatePoints(playerCharacterId, allocation) {
    return load().then(d => {
      const row = requireOwned(d, playerCharacterId);
      const p = progressOf(d, row);
      let total = 0;
      STATS.forEach(s => {
        const add = Math.round(Number(allocation[s.key]) || 0);
        if (add < 0) throw new Error('ステータスを下げることはできません');
        if (clampStat(row[s.key]) + (p.bonus[s.key] || 0) + add > STAT_MAX) {
          throw new Error(s.label + 'は' + STAT_MAX + 'より上げられません');
        }
        total += VolleyballProgression.statUpTotalCost(p.bonus[s.key] || 0, add);
      });
      if (total > p.points) throw new Error('育成ポイントが足りません');
      STATS.forEach(s => {
        const add = Math.round(Number(allocation[s.key]) || 0);
        if (add > 0) p.bonus[s.key] = (p.bonus[s.key] || 0) + add;
      });
      p.points -= total;
      return save(d).then(() => buildOwned(d, row));
    });
  }

  // ---------- ガチャ ----------

  // 選手マスタの表示用プロフィール(Lv1 の全ステータス。ガチャで獲得した直後の値と同じ)。
  function profileOf(m) {
    return Object.freeze({
      id: m.id,
      name: m.name,
      kana: m.kana,
      romaji: m.romaji,
      position: m.position,
      rarity: m.rarity,
      height: m.height,
      level: 1,
      stats: m.minStats
    });
  }

  function isActive(g, now) {
    return g.startAt <= now && (g.endAt == null || now <= g.endAt);
  }

  // 画面に渡すガチャ。
  function buildGacha(d, g, now) {
    const lineup = g.rates.map(r => Object.freeze({
      character: profileOf(d.master.get(r.characterId)),
      probability: r.probability
    }));
    const byRarity = {};
    lineup.forEach(l => {
      const k = l.character.rarity;
      byRarity[k] = byRarity[k] || { rarity: k, probability: 0, count: 0 };
      byRarity[k].probability += l.probability;
      byRarity[k].count++;
    });
    return Object.freeze({
      id: g.id,
      name: g.name,
      startAt: new Date(g.startAt),
      endAt: g.endAt == null ? null : new Date(g.endAt),
      isActive: isActive(g, now),
      currencyType: g.currencyType,
      currencyLabel: g.currencyType === 'item' ? (g.currencyItemName || CURRENCY_LABELS.item) : (CURRENCY_LABELS[g.currencyType] || g.currencyType),
      isFree: g.currencyType === 'free',
      singlePrice: g.singlePrice,
      multiPrice: g.multiPrice,
      rarityRates: Object.freeze(Object.keys(byRarity).map(k => Object.freeze(byRarity[k])).sort((a, b) => b.rarity - a.rarity)),
      lineup: Object.freeze(lineup.slice().sort((a, b) => b.character.rarity - a.character.rarity))
    });
  }

  /**
   * 今の時刻が有効期間内のガチャの一覧(ガチャマスタの順)。
   * @param {Date} [now]
   */
  function getActiveGachas(now) {
    const t = (now || new Date()).getTime();
    return load().then(d => d.gachas.filter(g => isActive(g, t)).map(g => buildGacha(d, g, t)));
  }

  /** ガチャ1つ(期間外でも返す。isActive で判定できる)。無ければ null。 */
  function getGacha(id, now) {
    const t = (now || new Date()).getTime();
    return load().then(d => {
      const g = d.gachas.find(x => x.id === String(id));
      return g ? buildGacha(d, g, t) : null;
    });
  }

  // 排出率(%)の重みで1人選ぶ。小数の誤差を避けるため 0.0001% 単位の整数で数える。
  function pickRate(rates) {
    const weights = rates.map(r => Math.round(r.probability * 10000));
    const total = weights.reduce((a, b) => a + b, 0);
    let x = Math.floor(Math.random() * total);
    for (let i = 0; i < rates.length; i++) {
      x -= weights[i];
      if (x < 0) return rates[i];
    }
    return rates[rates.length - 1];
  }

  /**
   * ガチャを引き、獲得した選手を所持選手(player_characters)に登録する。
   * 今は無料(currency_type = free)のガチャだけ引ける。
   * DB に移した時は、不正防止のため抽選と登録をサーバー側で行うこと。
   * @param {string} id - ガチャID
   * @param {number} count - 1 または 10
   * @returns {Promise<Array<{ playerCharacterId:number, isNew:boolean, character }>>}
   */
  function drawGacha(id, count) {
    return load().then(d => {
      const now = Date.now();
      const g = d.gachas.find(x => x.id === String(id));
      if (!g) throw new Error('ガチャが見つかりません');
      if (!isActive(g, now)) throw new Error('このガチャは開催期間外です');
      if (GACHA_COUNTS.indexOf(count) < 0) throw new Error('ガチャは1回か10回で引けます');
      if (g.currencyType !== 'free') throw new Error('有料のガチャはまだ引けません');
      if (!g.rates.some(r => r.probability > 0)) throw new Error('このガチャには排出される選手がいません');

      const owned = d.initialOwned.concat(d.progress.ownedCharacters);
      const ownedIds = new Set(owned.filter(r => r.player_id === d.playerId).map(r => r.character_id));
      // 売却した選手のIDも使い回さない
      let nextId = owned.map(r => r.player_character_id).concat(d.progress.sold)
        .reduce((max, id) => Math.max(max, id), d.maxPlayerCharacterId) + 1;
      const results = [];
      for (let i = 0; i < count; i++) {
        const m = d.master.get(pickRate(g.rates.filter(r => r.probability > 0)).characterId);
        const row = {
          player_character_id: nextId++,
          player_id: d.playerId,
          character_id: m.id,
          level: 1,
          exp: 0
        };
        ALL_STATS.forEach(s => { row[s.key] = m.minStats[s.key]; });
        d.progress.ownedCharacters.push(row);
        results.push(Object.freeze({
          playerCharacterId: row.player_character_id,
          isNew: !ownedIds.has(m.id),
          character: profileOf(m)
        }));
        ownedIds.add(m.id);
      }
      return save(d).then(() => results);
    });
  }

  // ---------- アイテム・ショップ ----------

  function itemCount(d, itemId) {
    return d.progress.items[itemId] != null ? d.progress.items[itemId] : (d.initialItems[itemId] || 0);
  }

  // 画面に渡すアイテム(マスタ + 所持数)。
  function buildItem(d, item) {
    return Object.freeze({
      id: item.id,
      type: item.type,
      typeLabel: ITEM_TYPE_LABELS[item.type] || item.type,
      name: item.name,
      effectValue: item.effectValue,
      count: itemCount(d, item.id)
    });
  }

  function currencyLabel(d, type, itemId) {
    if (type === 'item') {
      const item = d.itemMaster.get(itemId);
      return item ? item.name : CURRENCY_LABELS.item;
    }
    return CURRENCY_LABELS[type] || type;
  }

  /**
   * 所持しているアイテム(所持数1以上。コインは players の列で持つので含めない)。アイテムマスタの順。
   * @param {string} [type] - 指定すればその種別だけ(例 'exp_ticket')
   */
  function getItems(type) {
    return load().then(d => Array.from(d.itemMaster.values())
      .filter(i => i.type !== 'coin' && (!type || i.type === type))
      .map(i => buildItem(d, i))
      .filter(i => i.count > 0));
  }

  /** ショップの商品一覧(ショップ商品マスタの順)。今は無料(currency_type = free)の商品だけ買える。 */
  function getShopItems() {
    return load().then(d => d.shopItems.map(s => Object.freeze({
      id: s.id,
      item: buildItem(d, d.itemMaster.get(s.itemId)),
      quantity: s.quantity,
      currencyType: s.currencyType,
      currencyLabel: currencyLabel(d, s.currencyType, s.currencyItemId),
      price: s.price,
      isFree: s.currencyType === 'free',
      canBuy: s.currencyType === 'free' && d.itemMaster.get(s.itemId).type !== 'coin'
    })));
  }

  /**
   * ショップの商品を1回買う。今は無料の商品だけ。
   * DB に移した時は、不正防止のため購入処理をサーバー側で行うこと。
   * @returns {Promise<item>} 購入後のアイテム(所持数を含む)
   */
  function buyShopItem(shopItemId) {
    return load().then(d => {
      const s = d.shopItems.find(x => x.id === String(shopItemId));
      if (!s) throw new Error('商品が見つかりません');
      if (s.currencyType !== 'free') throw new Error('有料の商品はまだ買えません');
      const item = d.itemMaster.get(s.itemId);
      if (item.type === 'coin') throw new Error('コインはまだ買えません');
      d.progress.items[item.id] = itemCount(d, item.id) + s.quantity;
      return save(d).then(() => buildItem(d, item));
    });
  }

  /**
   * 経験値チケットを使って、選手に経験値を与える。
   * @param {number} playerCharacterId - 所持選手ID
   * @param {string} itemId - 経験値チケットのアイテムID
   * @param {number} [count=1] - 使う枚数
   * @returns {Promise<{ character, levelsGained, pointsGained, exp, item }>} exp は得た経験値の合計
   */
  function useExpTicket(playerCharacterId, itemId, count) {
    count = count == null ? 1 : Math.round(Number(count));
    return load().then(d => {
      const row = requireOwned(d, playerCharacterId);
      const item = d.itemMaster.get(String(itemId));
      if (!item || item.type !== 'exp_ticket') throw new Error('経験値チケットではありません');
      if (!(count >= 1)) throw new Error('使う枚数が正しくありません');
      if (itemCount(d, item.id) < count) throw new Error(item.name + 'が足りません');
      if (progressOf(d, row).level >= VolleyballProgression.MAX_LEVEL) throw new Error('これ以上レベルを上げられません');
      d.progress.items[item.id] = itemCount(d, item.id) - count;
      const r = grantExp(d, row, item.effectValue * count);
      return save(d).then(() => Object.assign(expResult(d, r), {
        exp: item.effectValue * count,
        item: buildItem(d, item)
      }));
    });
  }

  // ---------- プレイヤー ----------

  /**
   * 操作しているプレイヤーの名前と所持通貨。diamonds は有償+無償の合計。
   * 今は通貨を使う・増やす処理が無いので、マスタ(players)の値のまま。
   * @returns {Promise<{ id, name, diamonds, paidDiamonds, freeDiamonds, coins }>}
   */
  function getPlayer() {
    return load().then(d => Object.freeze(Object.assign({}, d.player, {
      diamonds: d.player.paidDiamonds + d.player.freeDiamonds
    })));
  }

  // ---------- 所持選手 ----------

  /**
   * 操作中のプレイヤーの所持選手(初期の所持選手 + ガチャで獲得した選手)。player_character_id の順。
   * 形は buildUnit()(team は自チームのデッキでの立ち位置と背番号。入っていなければ null)。
   */
  function getOwnedCharacters() {
    return load().then(d => ownedRows(d)
      .slice()
      .sort((a, b) => a.player_character_id - b.player_character_id)
      .map(row => buildOwned(d, row)));
  }

  /**
   * 所持選手をまとめて売却し、レア度に応じた経験値チケットを受け取る。
   * デッキに置かれている選手は売却できない。売却した選手のレベル・育成も消える。
   * DB に移した時は、不正防止のため売却処理をサーバー側で行うこと。
   * @param {number[]} playerCharacterIds - 所持選手ID(1人以上)
   * @returns {Promise<{ soldCount:number, rewards: Array<{ item, count }> }>} item は受け取り後の所持数を含む
   */
  function sellCharacters(playerCharacterIds) {
    return load().then(d => {
      const ids = Array.from(new Set((playerCharacterIds || []).map(Number)));
      if (!ids.length) throw new Error('売却する選手を選んでください');
      const rows = ids.map(id => requireOwned(d, id));
      rows.forEach(row => {
        if (d.deckIds.has(row.player_character_id)) {
          throw new Error(d.master.get(row.character_id).name + 'はデッキに入っているので売却できません');
        }
      });
      const totals = new Map(); // itemId → 個数
      rows.forEach(row => {
        const reward = sellRewardOf(d, d.master.get(row.character_id).rarity);
        if (reward) totals.set(reward.item.id, (totals.get(reward.item.id) || 0) + reward.count);
      });
      const soldIds = new Set(ids);
      d.progress.ownedCharacters = d.progress.ownedCharacters.filter(r => !soldIds.has(r.player_character_id));
      ids.forEach(id => {
        d.progress.sold.push(id);
        delete d.progress.owned[id];
      });
      totals.forEach((count, itemId) => { d.progress.items[itemId] = itemCount(d, itemId) + count; });
      return save(d).then(() => ({
        soldCount: ids.length,
        rewards: Array.from(totals.keys()).map(itemId => ({ item: buildItem(d, d.itemMaster.get(itemId)), count: totals.get(itemId) }))
      }));
    });
  }

  /** 所持選手1体。無ければ null。 */
  function getOwnedCharacter(playerCharacterId) {
    return load().then(d => {
      const row = ownedRow(d, playerCharacterId);
      return row ? buildOwned(d, row) : null;
    });
  }

  // データを読み直す(保存先側で内容が変わった時用)。
  function reload() {
    cache = null;
    return load();
  }

  global.VolleyballData = Object.freeze({
    STATS: STATS,
    ALL_STATS: ALL_STATS,
    STAT_MAX: STAT_MAX,
    POSITIONS: POSITIONS,
    GACHA_COUNTS: GACHA_COUNTS,
    registerSource: registerSource,
    configure: configure,
    getTeam: getTeam,
    getPlayer: getPlayer,
    allocatePoints: allocatePoints,
    getActiveGachas: getActiveGachas,
    getGacha: getGacha,
    drawGacha: drawGacha,
    getOwnedCharacters: getOwnedCharacters,
    getOwnedCharacter: getOwnedCharacter,
    sellCharacters: sellCharacters,
    getItems: getItems,
    getShopItems: getShopItems,
    buyShopItem: buyShopItem,
    useExpTicket: useExpTicket,
    reload: reload
  });
})(window);
