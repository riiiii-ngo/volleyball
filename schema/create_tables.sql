-- Volleyball game database (PostgreSQL)
-- schema.json / types.ts と同じ構造。
-- マスタ(characters, items, shop_items, gachas, gacha_details)のIDは手書きで管理する。
-- ゲーム中に作られる行(players, player_characters, party_decks)のIDは自動で採番する。

-- 1. プレイヤー情報マスタ
CREATE TABLE players (
    player_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_name    VARCHAR(32) NOT NULL CHECK (char_length(player_name) >= 1),
    paid_diamonds  INTEGER     NOT NULL DEFAULT 0 CHECK (paid_diamonds >= 0),
    free_diamonds  INTEGER     NOT NULL DEFAULT 0 CHECK (free_diamonds >= 0),
    coins          INTEGER     NOT NULL DEFAULT 0 CHECK (coins >= 0)
);

-- 2. 選手情報マスタ
CREATE TABLE characters (
    character_id  VARCHAR(32)  PRIMARY KEY,
    name          VARCHAR(64)  NOT NULL,
    kana_name     VARCHAR(128) NOT NULL,
    romaji_name   VARCHAR(128) NOT NULL,
    position      VARCHAR(2)   NOT NULL CHECK (position IN ('WS', 'MB', 'OP', 'SE', 'LI')),
    rarity        SMALLINT     NOT NULL CHECK (rarity BETWEEN 1 AND 5),
    height        SMALLINT     NOT NULL CHECK (height BETWEEN 100 AND 250),  -- cm
    min_spike     INTEGER NOT NULL CHECK (min_spike   >= 0),
    max_spike     INTEGER NOT NULL CHECK (max_spike   >= min_spike),
    min_receive   INTEGER NOT NULL CHECK (min_receive >= 0),
    max_receive   INTEGER NOT NULL CHECK (max_receive >= min_receive),
    min_block     INTEGER NOT NULL CHECK (min_block   >= 0),
    max_block     INTEGER NOT NULL CHECK (max_block   >= min_block),
    min_toss      INTEGER NOT NULL CHECK (min_toss    >= 0),
    max_toss      INTEGER NOT NULL CHECK (max_toss    >= min_toss),
    min_serve     INTEGER NOT NULL CHECK (min_serve   >= 0),
    max_serve     INTEGER NOT NULL CHECK (max_serve   >= min_serve),
    min_power     INTEGER NOT NULL CHECK (min_power   >= 0),
    max_power     INTEGER NOT NULL CHECK (max_power   >= min_power),
    min_speed     INTEGER NOT NULL CHECK (min_speed   >= 0),
    max_speed     INTEGER NOT NULL CHECK (max_speed   >= min_speed),
    min_stamina   INTEGER NOT NULL CHECK (min_stamina >= 0),
    max_stamina   INTEGER NOT NULL CHECK (max_stamina >= min_stamina),
    min_jump      INTEGER NOT NULL CHECK (min_jump    >= 0),
    max_jump      INTEGER NOT NULL CHECK (max_jump    >= min_jump),
    min_technique INTEGER NOT NULL CHECK (min_technique >= 0),
    max_technique INTEGER NOT NULL CHECK (max_technique >= min_technique)
);

-- 3. アイテム情報マスタ
CREATE TABLE items (
    item_id    VARCHAR(32) PRIMARY KEY,
    item_type  VARCHAR(32) NOT NULL CHECK (item_type IN ('coin', 'token', 'gacha_ticket')),
    item_name  VARCHAR(64) NOT NULL
);

-- 4. ショップ商品マスタ
--   currency_type: paid_diamond=有償ダイヤのみ / diamond=無償→有償の順に消費 / coin / item=アイテムで支払い / free=無料(値段は0)
CREATE TABLE shop_items (
    shop_item_id      VARCHAR(32) PRIMARY KEY,
    item_id           VARCHAR(32) NOT NULL REFERENCES items (item_id),
    quantity          INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    currency_type     VARCHAR(16) NOT NULL CHECK (currency_type IN ('paid_diamond', 'diamond', 'coin', 'item', 'free')),
    currency_item_id  VARCHAR(32) REFERENCES items (item_id),
    price             INTEGER     NOT NULL CHECK (price >= 0),
    CHECK ((currency_type = 'item') = (currency_item_id IS NOT NULL)),
    CHECK (currency_type <> 'free' OR price = 0)
);

-- 5. プレイヤー所持選手管理(同じ選手の重複所持あり)
CREATE TABLE player_characters (
    player_character_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id            BIGINT      NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    character_id         VARCHAR(32) NOT NULL REFERENCES characters (character_id),
    level                SMALLINT    NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
    exp                  INTEGER     NOT NULL DEFAULT 0 CHECK (exp >= 0),  -- 現在のレベル内の経験値
    spike                INTEGER NOT NULL CHECK (spike   >= 0),
    receive              INTEGER NOT NULL CHECK (receive >= 0),
    block                INTEGER NOT NULL CHECK (block   >= 0),
    toss                 INTEGER NOT NULL CHECK (toss    >= 0),
    serve                INTEGER NOT NULL CHECK (serve   >= 0),
    power                INTEGER NOT NULL CHECK (power   >= 0),
    speed                INTEGER NOT NULL CHECK (speed   >= 0),
    stamina              INTEGER NOT NULL CHECK (stamina >= 0),
    jump                 INTEGER NOT NULL CHECK (jump    >= 0),
    technique            INTEGER NOT NULL CHECK (technique >= 0)
);
CREATE INDEX idx_player_characters_player_id ON player_characters (player_id);

-- 5b. プレイヤー所持アイテム(プレイヤー×アイテムごとに1行)
--   コイン・ダイヤは players の列で持つため、item_type='coin' のアイテムはここに入れず players.coins に足す。
CREATE TABLE player_items (
    player_id  BIGINT      NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    item_id    VARCHAR(32) NOT NULL REFERENCES items (item_id),
    quantity   INTEGER     NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    PRIMARY KEY (player_id, item_id)
);

-- 6. スタメン編成管理
CREATE TABLE party_decks (
    deck_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id    BIGINT   NOT NULL REFERENCES players (player_id) ON DELETE CASCADE,
    deck_number  SMALLINT NOT NULL CHECK (deck_number BETWEEN 1 AND 5),
    UNIQUE (player_id, deck_number)
);

-- 7. スタメン配置詳細(party_decks と1対1)
--   各枠は「選手管理ID＋背番号(1〜99)」の組。未配置なら両方 NULL、配置したら両方必須。
--   デッキに置かれている所持選手は削除できない(先に枠から外す)。プレイヤーごと削除する時はデッキも一緒に消える。
--   「デッキと同じプレイヤーの所持選手であること」「選手・背番号が枠どうしで重複しないこと」はアプリ側で検証する。
CREATE TABLE party_deck_members (
    deck_id                  BIGINT PRIMARY KEY REFERENCES party_decks (deck_id) ON DELETE CASCADE,
    ws1_player_character_id  BIGINT REFERENCES player_characters (player_character_id),
    ws1_uniform_number       SMALLINT CHECK (ws1_uniform_number BETWEEN 1 AND 99),
    ws2_player_character_id  BIGINT REFERENCES player_characters (player_character_id),
    ws2_uniform_number       SMALLINT CHECK (ws2_uniform_number BETWEEN 1 AND 99),
    mb1_player_character_id  BIGINT REFERENCES player_characters (player_character_id),
    mb1_uniform_number       SMALLINT CHECK (mb1_uniform_number BETWEEN 1 AND 99),
    mb2_player_character_id  BIGINT REFERENCES player_characters (player_character_id),
    mb2_uniform_number       SMALLINT CHECK (mb2_uniform_number BETWEEN 1 AND 99),
    op_player_character_id   BIGINT REFERENCES player_characters (player_character_id),
    op_uniform_number        SMALLINT CHECK (op_uniform_number BETWEEN 1 AND 99),
    se_player_character_id   BIGINT REFERENCES player_characters (player_character_id),
    se_uniform_number        SMALLINT CHECK (se_uniform_number BETWEEN 1 AND 99),
    li_player_character_id   BIGINT REFERENCES player_characters (player_character_id),
    li_uniform_number        SMALLINT CHECK (li_uniform_number BETWEEN 1 AND 99),
    rotation_start_position  SMALLINT NOT NULL DEFAULT 1 CHECK (rotation_start_position BETWEEN 1 AND 6),
    CHECK ((ws1_player_character_id IS NULL) = (ws1_uniform_number IS NULL)),
    CHECK ((ws2_player_character_id IS NULL) = (ws2_uniform_number IS NULL)),
    CHECK ((mb1_player_character_id IS NULL) = (mb1_uniform_number IS NULL)),
    CHECK ((mb2_player_character_id IS NULL) = (mb2_uniform_number IS NULL)),
    CHECK ((op_player_character_id IS NULL) = (op_uniform_number IS NULL)),
    CHECK ((se_player_character_id IS NULL) = (se_uniform_number IS NULL)),
    CHECK ((li_player_character_id IS NULL) = (li_uniform_number IS NULL))
);

-- 8. ガチャマスタ(end_at が NULL なら常設。free の時は値段が両方0、それ以外は1以上)
CREATE TABLE gachas (
    gacha_id          VARCHAR(32) PRIMARY KEY,
    gacha_name        VARCHAR(64) NOT NULL,
    start_at          TIMESTAMPTZ NOT NULL,
    end_at            TIMESTAMPTZ,
    currency_type     VARCHAR(16) NOT NULL CHECK (currency_type IN ('paid_diamond', 'diamond', 'coin', 'item', 'free')),
    currency_item_id  VARCHAR(32) REFERENCES items (item_id),
    single_price      INTEGER     NOT NULL CHECK (single_price >= 0),
    multi_price       INTEGER     NOT NULL CHECK (multi_price  >= 0),
    CHECK (end_at IS NULL OR start_at < end_at),
    CHECK ((currency_type = 'free') = (single_price = 0 AND multi_price = 0)),
    CHECK ((currency_type = 'item') = (currency_item_id IS NOT NULL))
);

-- 9. ガチャ排出率詳細(probability は %。1ガチャの合計が100になることはアプリ側で検証する)
CREATE TABLE gacha_details (
    gacha_detail_id  BIGINT       PRIMARY KEY,
    gacha_id         VARCHAR(32)  NOT NULL REFERENCES gachas (gacha_id) ON DELETE CASCADE,
    character_id     VARCHAR(32)  NOT NULL REFERENCES characters (character_id),
    probability      DECIMAL(7,4) NOT NULL CHECK (probability > 0 AND probability <= 100),
    UNIQUE (gacha_id, character_id)
);
