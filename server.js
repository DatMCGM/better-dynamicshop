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

// ── Auth middleware ───────────────────────────────────────────
const requireApiKey = (req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// ══════════════════════════════════════════════════════════════
//  SYNC API — Plugin gửi data lên
// ══════════════════════════════════════════════════════════════

app.post('/api/sync/snapshot', requireApiKey, (req, res) => {
  try {
    const { serverId, serverName, items } = req.body;

    if (!serverId || !items || !Array.isArray(items)) {
      console.warn('[SYNC] Body thiếu field:', Object.keys(req.body));
      return res.status(400).json({ error: 'Missing serverId or items', received: Object.keys(req.body) });
    }

    db.saveSnapshot(serverId, serverName || serverId, items);

    // Phát real-time cho web client đang xem server này
    io.to(`server:${serverId}`).emit('priceUpdate', { serverId, items });

    res.json({ success: true, itemsUpdated: items.length });

  } catch (err) {
    console.error('[SYNC] Snapshot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/transactions', requireApiKey, (req, res) => {
  try {
    const { serverId, transactions } = req.body;

    if (!serverId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Missing serverId or transactions' });
    }

    db.saveTransactions(serverId, transactions);
    io.to(`server:${serverId}`).emit('newTransactions', { serverId, transactions });

    res.json({ success: true, count: transactions.length });

  } catch (err) {
    console.error('[SYNC] TX error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  WEB API — Frontend đọc data
// ══════════════════════════════════════════════════════════════

// Danh sách tất cả server
app.get('/api/servers', (req, res) => {
  try { res.json(db.getServers()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Items của 1 server
app.get('/api/servers/:serverId/items', (req, res) => {
  try { res.json(db.getServerItems(req.params.serverId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Lịch sử giá
app.get('/api/servers/:serverId/items/:material/history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const since = Date.now() - hours * 3600000;
    res.json(db.getItemHistory(req.params.serverId, req.params.material.toUpperCase(), since));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Giao dịch gần đây
app.get('/api/servers/:serverId/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    res.json(db.getRecentTx(req.params.serverId, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Top biến động
app.get('/api/servers/:serverId/top-movers', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    res.json(db.getTopMovers(req.params.serverId, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ADMIN API
// ══════════════════════════════════════════════════════════════

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

    db.saveSnapshot(serverId, item.server_id, [{
      material: material.toUpperCase(),
      displayName: item.display_name,
      baseBuy: item.base_buy, baseSell: item.base_sell,
      currentBuy: buyPrice, currentSell: sellPrice,
      totalBought: item.total_bought, totalSold: item.total_sold,
      buyChangePct: ((buyPrice - item.base_buy) / item.base_buy) * 100,
      sellChangePct: ((sellPrice - item.base_sell) / item.base_sell) * 100
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

// ── WebSocket ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Client subscribe vào 1 server cụ thể
  socket.on('joinServer', (serverId) => {
    socket.join(`server:${serverId}`);
    console.log(`[WS] ${socket.id} joined server: ${serverId}`);
  });

  socket.on('disconnect', () => {
    console.log('[WS] Disconnected:', socket.id);
  });
});

// ── Fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`╔═══════════════════════════════════════╗`);
  console.log(`║  DynamicShop Backend v2.0 chạy!      ║`);
  console.log(`║  Port: ${PORT}                            ║`);
  console.log(`╚═══════════════════════════════════════╝`);
});
