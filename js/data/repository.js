/**
 * VolleyballData
 * キャラクター・チームのデータ取得/保存の窓口。ゲーム側(画面・試合)は必ずここを通して読み書きし、
 * データが JSON ファイルにあるか DB にあるかを意識しない。
 *
 * データは2種類:
 *   - マスタ(初期値): キャラクターの基本ステータスとチーム編成。ゲーム側からは書き換えない。
 *   - セーブ(進行状況): キャラクターごとのレベル・経験値・育成ポイント・割り振ったステータスと、
 *     ガチャで獲得した所持選手(player_characters テーブルと同じ形の行)。
 *   画面に渡すキャラクターは、マスタの基本ステータスにセーブの割り振り分を足したもの。
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
 *   loadOwnedCharacters()   → { playerId, characters: Array<player_characters の行> }  初期の所持選手
 *   loadProgress()          → { characters: { [id]: { level, exp, points, bonus: { [stat]: n } } },
 *                               ownedCharacters?: Array<player_characters の行> } | null
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

  // セーブデータ上のキャラクターの進行状況(無ければマスタの初期レベルから作る)。
  function progressOf(data, id) {
    const master = data.master.get(id);
    let p = data.progress.characters[id];
    if (!p) {
      p = { level: master.level, exp: 0, points: 0, bonus: {} };
      data.progress.characters[id] = p;
    }
    return p;
  }

  // 画面に渡すキャラクター(マスタ + セーブの合成)。
  function buildCharacter(data, id) {
    const m = data.master.get(id);
    const p = progressOf(data, id);
    const bonus = {};
    const stats = {};
    STATS.forEach(s => {
      bonus[s.key] = p.bonus[s.key] || 0;
      stats[s.key] = Math.min(STAT_MAX, m.stats[s.key] + bonus[s.key]);
    });
    return Object.freeze({
      id: m.id,
      name: m.name,
      kana: m.kana,
      position: m.position,
      number: m.number,
      height: m.height,
      level: p.level,
      exp: p.exp,
      expToNext: VolleyballProgression.expToNext(p.level),
      points: p.points,
      baseStats: m.stats,
      bonus: Object.freeze(bonus),
      stats: Object.freeze(stats)
    });
  }

  // セーブデータの読み込み時補正(壊れた値・マスタに無いキャラは無視する)。
  function normalizeProgress(raw, master) {
    const out = { characters: {} };
    const chars = (raw && raw.characters) || {};
    Object.keys(chars).forEach(id => {
      if (!master.has(id)) return;
      const c = chars[id] || {};
      const bonus = {};
      STATS.forEach(s => {
        const v = Math.round(Number(c.bonus && c.bonus[s.key]) || 0);
        if (v > 0) bonus[s.key] = Math.min(v, STAT_MAX - master.get(id).stats[s.key]);
      });
      out.characters[id] = {
        level: Math.max(1, Math.min(VolleyballProgression.MAX_LEVEL, Math.round(Number(c.level) || 1))),
        exp: Math.max(0, Math.round(Number(c.exp) || 0)),
        points: Math.max(0, Math.round(Number(c.points) || 0)),
        bonus: bonus
      };
    });
    // ガチャで獲得した所持選手(壊れた行・マスタに無い選手は捨てる)
    out.ownedCharacters = ((raw && raw.ownedCharacters) || [])
      .map(row => normalizeOwnedRow(row, master))
      .filter(Boolean);
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

  function load() {
    if (!source) throw new Error('VolleyballData.configure() が呼ばれていません');
    if (!cache) {
      cache = Promise.all([
        source.loadCharacters(), source.loadTeams(), source.loadProgress(), source.loadGachas(), source.loadOwnedCharacters()
      ])
        .then(([rawChars, rawTeams, rawProgress, rawGachas, rawOwned]) => {
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
          return {
            master: master,
            teams: rawTeams,
            progress: normalizeProgress(rawProgress, master),
            gachas: rawGachas.map(g => normalizeGacha(g, master)),
            playerId: rawOwned.playerId,
            // 初期の所持選手(マスタ側。ゲームからは書き換えない)。獲得分は progress.ownedCharacters
            initialOwned: (rawOwned.characters || []).map(row => normalizeOwnedRow(row, master)).filter(Boolean)
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

  function getCharacters() {
    return load().then(d => Array.from(d.master.keys()).map(id => buildCharacter(d, id)));
  }

  function getCharacter(id) {
    return load().then(d => (d.master.has(String(id)) ? buildCharacter(d, String(id)) : null));
  }

  function getTeam(id) {
    return load().then(d => {
      const raw = d.teams.find(t => String(t.id) === String(id));
      if (!raw) throw new Error('チーム "' + id + '" が見つかりません');
      return Object.freeze({
        id: String(raw.id),
        name: raw.name || raw.id,
        members: Object.freeze((raw.members || []).map(m => Object.freeze({
          slot: m.slot,
          character: buildCharacter(d, String(m.characterId))
        })))
      });
    });
  }

  /**
   * 経験値を与える。レベルが上がれば育成ポイントも増える。
   * @param {string[]} ids - キャラクターID
   * @param {number} amount
   * @returns {Promise<Array<{character, levelsGained:number, pointsGained:number}>>}
   */
  function addExp(ids, amount) {
    return load().then(d => {
      const results = ids.filter(id => d.master.has(String(id))).map(id => {
        id = String(id);
        const p = progressOf(d, id);
        const r = VolleyballProgression.addExp(p, amount);
        p.level = r.level;
        p.exp = r.exp;
        p.points = r.points;
        return { id: id, levelsGained: r.levelsGained, pointsGained: r.pointsGained };
      });
      return save(d).then(() => results.map(r => ({
        character: buildCharacter(d, r.id),
        levelsGained: r.levelsGained,
        pointsGained: r.pointsGained
      })));
    });
  }

  /**
   * 育成ポイントをステータスに割り振る。
   * @param {string} id - キャラクターID
   * @param {Object<string, number>} allocation - 例 { speed: 2, receive: 1 }(上げる量)
   * @returns {Promise<character>} 割り振り後のキャラクター
   */
  function allocatePoints(id, allocation) {
    return load().then(d => {
      id = String(id);
      if (!d.master.has(id)) throw new Error('キャラクター "' + id + '" が見つかりません');
      const p = progressOf(d, id);
      const base = d.master.get(id).stats;
      let total = 0;
      STATS.forEach(s => {
        const add = Math.round(Number(allocation[s.key]) || 0);
        if (add < 0) throw new Error('ステータスを下げることはできません');
        if (base[s.key] + (p.bonus[s.key] || 0) + add > STAT_MAX) {
          throw new Error(s.label + 'は' + STAT_MAX + 'より上げられません');
        }
        total += add;
      });
      if (total > p.points) throw new Error('育成ポイントが足りません');
      STATS.forEach(s => {
        const add = Math.round(Number(allocation[s.key]) || 0);
        if (add > 0) p.bonus[s.key] = (p.bonus[s.key] || 0) + add;
      });
      p.points -= total;
      return save(d).then(() => buildCharacter(d, id));
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
      const ownedIds = new Set(owned.map(r => r.character_id));
      let nextId = owned.reduce((max, r) => Math.max(max, r.player_character_id), 0) + 1;
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

  // ---------- 所持選手 ----------

  /**
   * 操作中のプレイヤーの所持選手(初期の所持選手 + ガチャで獲得した選手)。player_character_id の順。
   * 自チーム('player')のデッキに入っている選手は、試合で上げたレベル・経験値・育成ポイントと
   * 割り振ったステータスを反映する(レベル・育成はまだ選手ID単位でセーブしているため)。
   * @returns {Promise<Array<{ playerCharacterId, level, exp, expToNext, points|null,
   *   stats: { [ALL_STATS のキー]: n }, bonus: { [stat]: n }, character, team: { slot, number }|null }>>}
   */
  function getOwnedCharacters() {
    return load().then(d => {
      const team = d.teams.find(t => String(t.id) === 'player');
      const inTeam = new Map();
      (team ? team.members : []).forEach(m => {
        if (m.playerCharacterId != null) inTeam.set(Number(m.playerCharacterId), m);
      });
      return d.initialOwned.concat(d.progress.ownedCharacters)
        .filter(row => row.player_id === d.playerId)
        .sort((a, b) => a.player_character_id - b.player_character_id)
        .map(row => {
          const m = inTeam.get(row.player_character_id);
          const p = m ? progressOf(d, row.character_id) : null;
          const stats = {};
          const bonus = {};
          ALL_STATS.forEach(s => {
            bonus[s.key] = (p && p.bonus[s.key]) || 0;
            stats[s.key] = Math.min(STAT_MAX, row[s.key] + bonus[s.key]);
          });
          const level = p ? p.level : row.level;
          return Object.freeze({
            playerCharacterId: row.player_character_id,
            level: level,
            exp: p ? p.exp : row.exp,
            expToNext: VolleyballProgression.expToNext(level),
            points: p ? p.points : null,
            stats: Object.freeze(stats),
            bonus: Object.freeze(bonus),
            character: profileOf(d.master.get(row.character_id)),
            team: m ? Object.freeze({ slot: m.slot, number: m.number != null ? m.number : null }) : null
          });
        });
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
    getCharacters: getCharacters,
    getCharacter: getCharacter,
    getTeam: getTeam,
    addExp: addExp,
    allocatePoints: allocatePoints,
    getActiveGachas: getActiveGachas,
    getGacha: getGacha,
    drawGacha: drawGacha,
    getOwnedCharacters: getOwnedCharacters,
    reload: reload
  });
})(window);
