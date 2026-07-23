import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pokerRooms = sqliteTable("poker_rooms", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const pokerSessions = sqliteTable(
  "poker_sessions",
  {
    token: text("token").primaryKey(),
    roomCode: text("room_code").notNull(),
    playerId: text("player_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("poker_sessions_room_player_idx").on(
      table.roomCode,
      table.playerId,
    ),
  ],
);

export const pokerEvents = sqliteTable(
  "poker_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomCode: text("room_code").notNull(),
    targetPlayerId: text("target_player_id"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("poker_events_room_id_idx").on(table.roomCode, table.id)],
);
