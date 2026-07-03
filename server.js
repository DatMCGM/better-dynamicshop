const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'change-this-secret-key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const requireApiKey = (req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// Debug — log toàn bộ request từ plugin
app.use('/api/sync', (req, res, next) => {
  const body = req.body || {};
  console.log(`[SYNC] ${req.method} ${req.path}`);
  console.log(`[SYNC] Keys: ${Object.keys(body).join(', ')}`);
  console.log(`[SYNC] Body preview: ${JSON.stringify(body).substring(0, 300)}`);
  next();
});

// ── Snapshot ──────────────────────────────────────────────
app.post('/api/sync/snapshot', requireApiKey, (req, res) => {
  try {
    const body = req.body || {};

    // Lấy serverId — plugin gửi dưới dạng "serverId"
    const serverId = body.serverId || body.server_id || 'unknown';
    const serverName = body.serverName || body.server_name || serverId;

    // Lấy items — có thể là array hoặc object
    let items = body.items;
    if (!items) {
      console.warn('[SYNC] Không có field items, body:', JSON.stringify(body).substring(0, 500));
      return res.status(400).json({ error: 'Missing items', received: Object.keys(body) });
    }
    if (!Array.isArray(items)) items = Object.values(items);
    if (items.length === 0) return res.json({ success: true, count: 0 });

    db.saveSnapshot(serverId, serverName, items);
    io.to(`server:${serverId}`).emit('priceUpdate', { serverId, items });

    console.log(`[SYNC] OK — server=${serverId} items=${items.length}`);
    res.json({ success: true, count: items.length });

  } catch (err) {
    console.error('[SYNC] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Transactions ──────────────────────────────────────────
app.post('/api/sync/transactions', requireApiKey, (req, res) => {
  try {
    const body = req.body || {};
    const serverId = body.serverId || body.server_id || 'unknown';
    let transactions = body.transactions;

    if (!transactions) return res.status(400).json({ error: 'Missing transactions' });
    if (!Array.isArray(transactions)) transactions = Object.values(transactions);
    if (transactions.length === 0) return res.json({ success: true, count: 0 });

    db.saveTransactions(serverId, transactions);
    io.to(`server:${serverId}`).emit('newTransactions', { serverId, transactions });

    console.log(`[SYNC] TX OK — server=${serverId} count=${transactions.length}`);
    res.json({ success: true, count: transactions.length });

  } catch (err) {
    console.error('[SYNC] TX Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Web API ───────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
  try { res.json(db.getServers()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servers/:serverId/items', (req, res) => {
  try { res.json(db.getServerItems(req.params.serverId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servers/:serverId/items/:material/history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = Date.now() - hours * 3600000;
    res.json(db.getItemHistory(req.params.serverId, req.params.material.toUpperCase(), since));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servers/:serverId/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    res.json(db.getRecentTx(req.params.serverId, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servers/:serverId/top-movers', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    res.json(db.getTopMovers(req.params.serverId, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Admin ─────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: API_KEY });
  } else {
    res.status(401).json({ error: 'Sai mật khẩu' });
  }
});

app.post('/api/admin/set-price', requireApiKey, (req, res) => {
  try {
    const { serverId, material, buyPrice, sellPrice } = req.body;
    if (!serverId || !material || buyPrice == null || sellPrice == null) {
      return res.status(400).json({ error: 'Thiếu thông tin' });
    }
    const item = db.getServerItem(serverId, material.toUpperCase());
    if (!item) return res.status(404).json({ error: 'Item không tồn tại' });

    db.saveSnapshot(serverId, serverId, [{
      material: material.toUpperCase(),
      displayName: item.display_name,
      baseBuy: item.base_buy, baseSell: item.base_sell,
      currentBuy: buyPrice, currentSell: sellPrice,
      totalBought: item.total_bought, totalSold: item.total_sold,
      buyChangePct: item.base_buy > 0 ? ((buyPrice - item.base_buy) / item.base_buy) * 100 : 0,
      sellChangePct: item.base_sell > 0 ? ((sellPrice - item.base_sell) / item.base_sell) * 100 : 0
    }]);

    io.to(`server:${serverId}`).emit('priceUpdate', {
      serverId,
      items: [{ material: material.toUpperCase(), currentBuy: buyPrice, currentSell: sellPrice }]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WebSocket ─────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('joinServer', (serverId) => {
    socket.join(`server:${serverId}`);
    console.log(`[WS] ${socket.id} joined ${serverId}`);
  });
  socket.on('disconnect', () => console.log('[WS] Disconnected:', socket.id));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`DynamicShop Backend v2 chạy trên port ${PORT}`);
});
