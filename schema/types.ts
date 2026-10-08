// Volleyball game database - row types.
// フィールド名は schema.json / create_tables.sql の列名と同じ(snake_case)にして、変換なしで読み書きできるようにしている。

/** マスタのID(手書きの文字列コード。例: "c001") */
export type MasterId = string;
/** ゲーム中に発行されるID(DBの自動採番) */
export type SerialId = number;
/** タイムゾーン付きISO 8601の日時文字列(例: "2026-10-05T12:00:00+09:00") */
export type DateTimeString = string;

export const POSITIONS = ['WS', 'MB', 'OP', 'SE', 'LI'] as const;
/** WS=ウイングスパイカー, MB=ミドルブロッカー, OP=オポジット, SE=セッター, LI=リベロ */
export type Position = (typeof POSITIONS)[number];

export const ITEM_TYPES = ['coin', 'token', 'gacha_ticket', 'exp_ticket'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const CURRENCY_TYPES = ['paid_diamond', 'diamond', 'coin', 'item', 'free'] as const;
/** paid_diamond=有償ダイヤのみ, diamond=無償→有償の順に消費, coin=コイン, item=アイテム(currency_item_id で指定), free=無料(値段は0) */
export type CurrencyType = (typeof CURRENCY_TYPES)[number];

export const STAT_KEYS = ['spike', 'receive', 'block', 'toss', 'serve', 'power', 'speed', 'stamina', 'jump', 'technique'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** 支払い方法。currency_item_id は currency_type が 'item' の時だけ入る。 */
export type Payment =
  | { currency_type: Exclude<CurrencyType, 'item'>; currency_item_id: null }
  | { currency_type: 'item'; currency_item_id: MasterId };

/** 1. プレイヤー情報マスタ */
export interface Player {
  player_id: SerialId; // PK
  player_name: string;
  paid_diamonds: number;
  free_diamonds: number;
  coins: number;
}

/** 2. 選手情報マスタ(min_* = Lv1(獲得時)の値。上限値は持たない) */
export interface Character {
  character_id: MasterId; // PK
  name: string;
  kana_name: string;
  romaji_name: string;
  position: Position;
  rarity: 1 | 2 | 3 | 4 | 5;
  height: number; // cm
  min_spike: number;
  min_receive: number;
  min_block: number;
  min_toss: number;
  min_serve: number;
  min_power: number;
  min_speed: number;
  min_stamina: number;
  min_jump: number;
  min_technique: number;
}

/** 3. アイテム情報マスタ */
export interface Item {
  item_id: MasterId; // PK
  item_type: ItemType;
  item_name: string;
  effect_value: number | null; // 使った時の効果量(exp_ticket は獲得経験値)。効果の無い種別は null
}

/** 4. ショップ商品マスタ */
export type ShopItem = Payment & {
  shop_item_id: MasterId; // PK
  item_id: MasterId; // FK -> items
  quantity: number;
  price: number;
};

/** プレイヤー所持アイテム(PK = player_id + item_id)。coin 種別はここに入れず players.coins に足す */
export interface PlayerItem {
  player_id: SerialId; // PK, FK -> players
  item_id: MasterId; // PK, FK -> items
  quantity: number;
}

/** 5. プレイヤー所持選手管理(各ステータスは現在値) */
export type PlayerCharacter = {
  player_character_id: SerialId; // PK
  player_id: SerialId; // FK -> players
  character_id: MasterId; // FK -> characters
  level: number; // 1〜50
  exp: number; // 現在のレベル内の経験値
} & Record<StatKey, number>;

/** 6. スタメン編成管理 */
export interface PartyDeck {
  deck_id: SerialId; // PK
  player_id: SerialId; // FK -> players
  deck_number: number; // 1〜5、プレイヤー内で一意
}

/** 背番号(1〜99) */
export type UniformNumber = number;

export const DECK_SLOTS = ['ws1', 'ws2', 'mb1', 'mb2', 'op', 'se', 'li'] as const;
export type DeckSlotKey = (typeof DECK_SLOTS)[number];

/**
 * 7. スタメン配置詳細(party_decks と1対1)。
 * 枠ごとに <枠>_player_character_id(FK -> player_characters)と <枠>_uniform_number を持つ。
 * 未配置なら両方 null、配置したら両方必須。
 */
export type PartyDeckMember = {
  deck_id: SerialId; // PK, FK -> party_decks
  rotation_start_position: 1 | 2 | 3 | 4 | 5 | 6;
} & {
  [K in DeckSlotKey as `${K}_player_character_id`]: SerialId | null;
} & {
  [K in DeckSlotKey as `${K}_uniform_number`]: UniformNumber | null;
};

/** 8. ガチャマスタ(end_at が null なら常設) */
export type Gacha = Payment & {
  gacha_id: MasterId; // PK
  gacha_name: string;
  start_at: DateTimeString;
  end_at: DateTimeString | null;
  single_price: number; // free の時は0
  multi_price: number; // free の時は0
};

/** 9. ガチャ排出率詳細(probability は %。例: 0.75 = 0.75%) */
export interface GachaDetail {
  gacha_detail_id: SerialId; // PK
  gacha_id: MasterId; // FK -> gachas
  character_id: MasterId; // FK -> characters
  probability: number;
}

/** テーブル名 → 行の型 */
export interface Tables {
  players: Player;
  characters: Character;
  items: Item;
  shop_items: ShopItem;
  player_items: PlayerItem;
  player_characters: PlayerCharacter;
  party_decks: PartyDeck;
  party_deck_members: PartyDeckMember;
  gachas: Gacha;
  gacha_details: GachaDetail;
}

export type TableName = keyof Tables;

/** schema.json のトップレベルの形(テーブル名 → レコード配列) */
export type Database = { [K in TableName]: Tables[K][] };
