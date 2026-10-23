//! Desktop shell for Holdr.
//!
//! The Rust side is intentionally thin: it hosts the web UI, owns the SQLite
//! database (via `tauri-plugin-sql`) and performs HTTP requests for market
//! data (via `tauri-plugin-http`), which are restricted to the hosts listed in
//! `capabilities/default.json`. Backups are read and written through native
//! file dialogs; only the file the user picks becomes accessible. There is no
//! telemetry of any kind.

mod license;
mod license_public_key;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Connection string shared with the frontend (`src/data/sqliteRepository.ts`).
const DATABASE_URL: &str = "sqlite:holdr.db";

/// Schema migrations, applied in order on startup. Never edit a released
/// migration; add a new one instead.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
            CREATE TABLE instruments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol      TEXT    NOT NULL UNIQUE,
                name        TEXT    NOT NULL,
                currency    TEXT    NOT NULL,
                exchange    TEXT,
                kind        TEXT,
                created_at  TEXT    NOT NULL
            );

            CREATE TABLE transactions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_id  INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
                type           TEXT    NOT NULL CHECK (type IN ('BUY', 'SELL', 'DIVIDEND')),
                trade_date     TEXT    NOT NULL,
                quantity       REAL,
                price          REAL,
                amount         REAL,
                fee            REAL    NOT NULL DEFAULT 0,
                note           TEXT,
                created_at     TEXT    NOT NULL,
                CHECK (
                    (type IN ('BUY', 'SELL') AND quantity > 0 AND price >= 0)
                    OR (type = 'DIVIDEND' AND amount IS NOT NULL)
                )
            );
            CREATE INDEX idx_transactions_instrument ON transactions (instrument_id, trade_date);

            CREATE TABLE quotes (
                symbol          TEXT PRIMARY KEY,
                price           REAL NOT NULL,
                previous_close  REAL,
                currency        TEXT NOT NULL,
                fetched_at      TEXT NOT NULL
            );

            CREATE TABLE settings (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_watchlist",
            sql: r#"
            CREATE TABLE watchlist (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol       TEXT    NOT NULL UNIQUE,
                name         TEXT    NOT NULL,
                currency     TEXT    NOT NULL,
                exchange     TEXT,
                kind         TEXT,
                added_at     TEXT    NOT NULL,
                added_price  REAL
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "separate_taxes_from_fees",
            // Existing rows keep their combined value in `fee`, as entered.
            sql: "ALTER TABLE transactions ADD COLUMN tax REAL NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        // No file system paths are allowed statically: the dialog plugin adds
        // exactly the file the user picks to the fs scope at runtime.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![license::verify_license])
        .run(tauri::generate_context!())
        .expect("error while running Holdr");
}
