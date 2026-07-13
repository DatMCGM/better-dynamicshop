const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'dynamicshop.db'));
db.pragma('journal_mode = WAL');

// ── Tạo bảng ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    server_id TEXT PRIMARY KEY,
    server_name TEXT NOT NULL,
    last_seen INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    material TEXT NOT NULL,
    display_name TEXT,
    base_buy REAL DEFAULT 0,
    base_sell REAL DEFAULT 0,
    current_buy REAL DEFAULT 0,
    current_sell REAL DEFAULT 0,
    total_bought INTEGER DEFAULT 0,
    total_sold INTEGER DEFAULT 0,
    buy_change_pct REAL DEFAULT 0,
    sell_change_pct REAL DEFAULT 0,
    updated_at INTEGER,
    UNIQUE(server_id, material)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    material TEXT NOT NULL,
    buy_price REAL,
    sell_price REAL,
    timestamp INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    material TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    buy_price REAL,
    sell_price REAL,
    timestamp INTEGER NOT NULL
  )
`);

// Indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_items_server ON items(server_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_history_server_mat ON price_history(server_id, material)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tx_server ON transactions(server_id, timestamp)`);

// ── Prepared statements ──────────────────────────────────────
const upsertServer = db.prepare(`
  INSERT INTO servers (server_id, server_name, last_seen)
  VALUES (@serverId, @serverName, @now)
  ON CONFLICT(server_id) DO UPDATE SET
    server_name = @serverName, last_seen = @now
`);

const upsertItem = db.prepare(`
  INSERT INTO items (server_id, material, display_name, base_buy, base_sell,
    current_buy, current_sell, total_bought, total_sold,
    buy_change_pct, sell_change_pct, updated_at)
  VALUES (@serverId, @material, @displayName, @baseBuy, @baseSell,
    @currentBuy, @currentSell, @totalBought, @totalSold,
    @buyChangePct, @sellChangePct, @now)
  ON CONFLICT(server_id, material) DO UPDATE SET
    display_name = @displayName,
    current_buy = @currentBuy, current_sell = @currentSell,
    total_bought = @totalBought, total_sold = @totalSold,
    buy_change_pct = @buyChangePct, sell_change_pct = @sellChangePct,
    updated_at = @now
`);

const insertHistory = db.prepare(`
  INSERT INTO price_history (server_id, material, buy_price, sell_price, timestamp)
  VALUES (@serverId, @material, @buyPrice, @sellPrice, @timestamp)
`);

const insertTx = db.prepare(`
  INSERT INTO transactions (server_id, material, type, amount, buy_price, sell_price, timestamp)
  VALUES (@serverId, @material, @type, @amount, @buyPrice, @sellPrice, @timestamp)
`);

// ── Functions ────────────────────────────────────────────────

function saveSnapshot(serverId, serverName, items) {
  const now = Date.now();
  const run = db.transaction(() => {
    upsertServer.run({ serverId, serverName, now });
    for (const item of items) {
      upsertItem.run({
        serverId, material: item.material,
        displayName: item.displayName || item.material,
        baseBuy: item.baseBuy || 0, baseSell: item.baseSell || 0,
        currentBuy: item.currentBuy || 0, currentSell: item.currentSell || 0,
        totalBought: item.totalBought || 0, totalSold: item.totalSold || 0,
        buyChangePct: item.buyChangePct || 0, sellChangePct: item.sellChangePct || 0,
        now
      });
      insertHistory.run({
        serverId, material: item.material,
        buyPrice: item.currentBuy, sellPrice: item.currentSell,
        timestamp: now
      });
    }
  });
  run();
}

function saveTransactions(serverId, transactions) {
  const run = db.transaction(() => {
    for (const tx of transactions) {
      insertTx.run({
        serverId, material: tx.material,
        type: tx.type, amount: tx.amount || 0,
        buyPrice: tx.buyPrice, sellPrice: tx.sellPrice,
        timestamp: tx.timestamp || Date.now()
      });
    }
  });
  run();
}

module.exports = {
  db,
  saveSnapshot,
  saveTransactions,
  getServers: () => db.prepare(`SELECT * FROM servers ORDER BY last_seen DESC`).all(),
  getServerItems: (serverId) =>
    db.prepare(`SELECT * FROM items WHERE server_id = ? ORDER BY display_name`).all(serverId),
  getItemHistory: (serverId, material, since) =>
    db.prepare(`SELECT * FROM price_history WHERE server_id = ? AND material = ? AND timestamp > ? ORDER BY timestamp ASC`).all(serverId, material, since),
  getItemTransactions: (serverId, material, since) =>
    db.prepare(`SELECT * FROM transactions WHERE server_id = ? AND material = ? AND timestamp > ? ORDER BY timestamp ASC`).all(serverId, material, since),
  getRecentTx: (serverId, limit) =>
    db.prepare(`SELECT * FROM transactions WHERE server_id = ? ORDER BY timestamp DESC LIMIT ?`).all(serverId, limit),
  getTopMovers: (serverId, limit) =>
    db.prepare(`SELECT *, ABS(buy_change_pct) as abs_change FROM items WHERE server_id = ? ORDER BY abs_change DESC LIMIT ?`).all(serverId, limit),
  getServerItem: (serverId, material) =>
    db.prepare(`SELECT * FROM items WHERE server_id = ? AND material = ?`).get(serverId, material),
};
