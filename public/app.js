// ════════════════════════════════════════════════════════
//  DynamicShop Dashboard v2.0 — Multi-server
// ════════════════════════════════════════════════════════

const socket = io();
let currentServer = null;
let allItems = [];
let selectedMaterial = null;
let chartHours = 24;
let priceChart = null;
let volumeChart = null;
let adminToken = null;
let searchQuery = '';

// ── Helpers ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmtUSD = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%';
const fmtNum = (n) => Number(n).toLocaleString('en-US');
const chgClass = (pct) => pct > 0.2 ? 'up' : pct < -0.2 ? 'dn' : 'flat';
const chgArrow = (pct) => pct > 0.2 ? '▲' : pct < -0.2 ? '▼' : '—';

// ── WebSocket ─────────────────────────────────────────────
socket.on('connect', () => {
  $('connDot').classList.add('live');
  $('connLabel').textContent = 'Trực tiếp';
  if (currentServer) socket.emit('joinServer', currentServer);
});

socket.on('disconnect', () => {
  $('connDot').classList.remove('live');
  $('connLabel').textContent = 'Mất kết nối';
});

socket.on('priceUpdate', ({ serverId, items }) => {
  if (serverId !== currentServer) return;
  items.forEach(upd => {
    const idx = allItems.findIndex(i => i.material === upd.material);
    if (idx !== -1) Object.assign(allItems[idx], {
      current_buy: upd.currentBuy ?? allItems[idx].current_buy,
      current_sell: upd.currentSell ?? allItems[idx].current_sell,
      buy_change_pct: upd.buyChangePct ?? allItems[idx].buy_change_pct,
      sell_change_pct: upd.sellChangePct ?? allItems[idx].sell_change_pct,
      total_bought: upd.totalBought ?? allItems[idx].total_bought,
      total_sold: upd.totalSold ?? allItems[idx].total_sold,
    });
  });
  renderItemList();
  renderTicker();
  if (items.some(i => i.material === selectedMaterial)) updateChartInfo();
});

socket.on('newTransactions', ({ serverId }) => {
  if (serverId !== currentServer) return;
  loadTopMovers();
  loadRecentTx();
});

// ── Load servers ──────────────────────────────────────────
async function loadServers() {
  try {
    const res = await fetch('/api/servers');
    const servers = await res.json();
    const sel = $('serverSelect');
    sel.innerHTML = '<option value="">— Chọn server —</option>';
    servers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.server_id;
      opt.textContent = s.server_name + ' (' + s.server_id + ')';
      sel.appendChild(opt);
    });

    // Auto-select nếu chỉ có 1 server
    if (servers.length === 1) {
      sel.value = servers[0].server_id;
      switchServer(servers[0].server_id);
    }
  } catch (e) {
    console.error('Lỗi tải servers:', e);
  }
}

function switchServer(serverId) {
  if (!serverId) return;
  currentServer = serverId;
  allItems = [];
  selectedMaterial = null;
  socket.emit('joinServer', serverId);
  loadItems();
  loadTopMovers();
  loadRecentTx();
}

$('serverSelect').addEventListener('change', (e) => switchServer(e.target.value));

// ── Tìm kiếm vật phẩm ─────────────────────────────────────
$('itemSearchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderItemList();
});

// ── Load items ────────────────────────────────────────────
async function loadItems() {
  if (!currentServer) return;
  try {
    const res = await fetch(`/api/servers/${currentServer}/items`);
    allItems = await res.json();

    if (allItems.length === 0) {
      $('itemList').innerHTML = '<div class="empty">Chưa có dữ liệu.<br>Đảm bảo plugin DynamicShop đang chạy.</div>';
      return;
    }

    if (!selectedMaterial) selectedMaterial = allItems[0].material;
    renderItemList();
    renderTicker();
    renderChart();
    populatePriceSelect();
  } catch (e) { console.error('loadItems:', e); }
}

// ── Render: Item list ─────────────────────────────────────
function renderItemList() {
  $('itemCount').textContent = allItems.length;

  const filtered = searchQuery
    ? allItems.filter(item =>
        (item.display_name || '').toLowerCase().includes(searchQuery) ||
        (item.material || '').toLowerCase().includes(searchQuery))
    : allItems;

  if (filtered.length === 0) {
    $('itemList').innerHTML = `<div class="empty">Không tìm thấy vật phẩm nào khớp với "${searchQuery}"</div>`;
    return;
  }

  $('itemList').innerHTML = filtered.map(item => {
    const pct = item.buy_change_pct || 0;
    const cls = chgClass(pct);
    const active = item.material === selectedMaterial ? 'active' : '';
    return `
      <div class="item-row ${active}" data-mat="${item.material}">
        <div>
          <div class="iname">${item.display_name || item.material}</div>
          <div class="imat">${item.material}</div>
        </div>
        <div>
          <div class="iprice">${fmtUSD(item.current_buy)}</div>
          <div class="ichg ${cls}">${chgArrow(pct)} ${fmtPct(pct)}</div>
        </div>
      </div>`;
  }).join('');

  $('itemList').querySelectorAll('.item-row').forEach(row => {
    row.addEventListener('click', () => {
      selectedMaterial = row.dataset.mat;
      renderItemList();
      renderChart();
    });
  });
}

// ── Render: Ticker ────────────────────────────────────────
function renderTicker() {
  const doubled = [...allItems, ...allItems];
  const track = $('tickerTrack');
  track.innerHTML = doubled.map(item => {
    const pct = item.buy_change_pct || 0;
    const cls = chgClass(pct);
    return `
      <span class="tick">
        <span class="tick-sym">${item.material}</span>
        <span class="tick-val">${fmtUSD(item.current_buy)}</span>
        <span class="tick-chg ${cls}">${chgArrow(pct)} ${fmtPct(pct)}</span>
      </span>`;
  }).join('');

  // Tốc độ chạy cố định (px/giây) thay vì thời gian cố định,
  // để ticker không bị chạy nhanh dần khi có nhiều item.
  const PIXELS_PER_SECOND = 60; // chỉnh số này để nhanh/chậm hơn
  const trackWidth = track.scrollWidth;
  const duration = Math.max(trackWidth / PIXELS_PER_SECOND, 15); // tối thiểu 15s
  track.style.animationDuration = duration + 's';
}

// ── Gộp dữ liệu tick thành nến OHLC (Open/High/Low/Close) ──
function bucketMsFor(hours) {
  if (hours <= 1) return 2 * 60 * 1000;        // 1G  → nến 2 phút
  if (hours <= 6) return 15 * 60 * 1000;       // 6G  → nến 15 phút
  if (hours <= 24) return 60 * 60 * 1000;      // 24G → nến 1 giờ
  return 6 * 60 * 60 * 1000;                   // 7N  → nến 6 giờ
}

function toCandles(history, field, bucketMs) {
  if (!history.length) return [];
  const buckets = new Map();
  // history đã sắp xếp tăng dần theo timestamp (ASC) từ backend
  for (const h of history) {
    const price = h[field];
    if (price == null) continue;
    const bucketStart = Math.floor(h.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, { x: bucketStart, o: price, h: price, l: price, c: price });
    } else {
      const b = buckets.get(bucketStart);
      b.h = Math.max(b.h, price);
      b.l = Math.min(b.l, price);
      b.c = price; // giá cuối cùng trong bucket = giá đóng cửa
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.x - b.x);
}

// ── Gộp giao dịch thành khối lượng (volume) theo bucket ────
function toVolumeBuckets(transactions, bucketMs) {
  const buckets = new Map();
  for (const tx of transactions) {
    const bucketStart = Math.floor(tx.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, { x: bucketStart, buy: 0, sell: 0 });
    }
    const b = buckets.get(bucketStart);
    if (tx.type === 'BUY') b.buy += (tx.amount || 0);
    else if (tx.type === 'SELL') b.sell += (tx.amount || 0);
  }
  return Array.from(buckets.values()).sort((a, b) => a.x - b.x);
}

function fmtCompact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

// ── Render: Chart ─────────────────────────────────────────
function hasCandlestickSupport() {
  try {
    return !!(window.Chart && Chart.registry && Chart.registry.controllers.get('candlestick'));
  } catch { return false; }
}

async function renderChart() {
  const item = allItems.find(i => i.material === selectedMaterial);
  if (!item) return;

  updateChartInfo(item);

  const chartBody = document.querySelector('.chart-body');
  chartBody.querySelectorAll('.empty').forEach(el => el.remove());

  try {
    const res = await fetch(`/api/servers/${currentServer}/items/${selectedMaterial}/history?hours=${chartHours}`);
    const history = await res.json();

    if (priceChart) { priceChart.destroy(); priceChart = null; }

    if (history.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'empty';
      placeholder.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)';
      placeholder.textContent = 'Chưa có dữ liệu lịch sử cho khung thời gian này';
      chartBody.appendChild(placeholder);
      if (volumeChart) { volumeChart.destroy(); volumeChart = null; }
      $('volTotal').textContent = '—';
      return;
    }

    const bucketMs = bucketMsFor(chartHours);
    const buyCandles = toCandles(history, 'buy_price', bucketMs);
    const sellLine = toCandles(history, 'sell_price', bucketMs).map(c => ({ x: c.x, y: c.c }));
    const timeUnit = chartHours <= 1 ? 'minute' : chartHours <= 24 ? 'hour' : 'day';

    const ctx = $('priceChart').getContext('2d');
    const canUseCandles = buyCandles.length > 0 && hasCandlestickSupport();

    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#8b95a7', font: { family: 'JetBrains Mono', size: 11 }, boxWidth: 14, padding: 16 }
        },
        tooltip: {
          backgroundColor: '#141920',
          borderColor: '#1e2631',
          borderWidth: 1,
          titleColor: '#e8edf5',
          bodyColor: '#e8edf5',
          padding: 10,
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          callbacks: {
            label: ctx => {
              if (ctx.dataset.type === 'candlestick') {
                const r = ctx.raw;
                return [
                  `Mở: ${fmtUSD(r.o)}`,
                  `Cao: ${fmtUSD(r.h)}`,
                  `Thấp: ${fmtUSD(r.l)}`,
                  `Đóng: ${fmtUSD(r.c)}`
                ];
              }
              return `${ctx.dataset.label}: ${fmtUSD(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: timeUnit },
          grid: { color: '#1a2028' },
          ticks: { color: '#4a5568', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 }
        },
        y: {
          grid: { color: '#1a2028' },
          ticks: {
            color: '#4a5568',
            font: { family: 'JetBrains Mono', size: 10 },
            callback: v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })
          }
        }
      }
    };

    try {
      if (canUseCandles) {
        // ── Biểu đồ nến (candlestick) ──
        priceChart = new Chart(ctx, {
          data: {
            datasets: [
              {
                type: 'candlestick',
                label: 'Giá Mua',
                data: buyCandles,
                color: { up: '#3ddc84', down: '#f0614e', unchanged: '#8b95a7' },
                borderColor: { up: '#3ddc84', down: '#f0614e', unchanged: '#8b95a7' },
                backgroundColor: { up: 'rgba(61,220,132,0.5)', down: 'rgba(240,97,78,0.5)', unchanged: 'rgba(139,149,167,0.5)' }
              },
              {
                type: 'line',
                label: 'Giá Bán',
                data: sellLine,
                borderColor: '#5ec8e0',
                borderWidth: 1.5,
                borderDash: [4, 3],
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.2,
                fill: false
              }
            ]
          },
          options: baseOptions
        });
      } else {
        throw new Error('candlestick-unavailable');
      }
    } catch (chartErr) {
      // ── Dự phòng: nếu plugin nến lỗi/không có, vẫn hiện biểu đồ đường ──
      console.warn('Không dựng được biểu đồ nến, dùng biểu đồ đường dự phòng:', chartErr);
      const closeLine = buyCandles.map(c => ({ x: c.x, y: c.c }));
      priceChart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Giá Mua',
              data: closeLine,
              borderColor: '#3ddc84',
              backgroundColor: 'rgba(61,220,132,0.08)',
              borderWidth: 1.5,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.25,
              fill: true
            },
            {
              label: 'Giá Bán',
              data: sellLine,
              borderColor: '#5ec8e0',
              borderWidth: 1.5,
              borderDash: [4, 3],
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.2,
              fill: false
            }
          ]
        },
        options: baseOptions
      });
    }

    // ── Biểu đồ khối lượng giao dịch ──
    renderVolumeChart(bucketMs, timeUnit);

  } catch (e) { console.error('renderChart:', e); }
}

// ── Render: Volume chart ────────────────────────────────────
async function renderVolumeChart(bucketMs, timeUnit) {
  try {
    const res = await fetch(`/api/servers/${currentServer}/items/${selectedMaterial}/transactions?hours=${chartHours}`);
    const txs = await res.json();

    if (volumeChart) { volumeChart.destroy(); volumeChart = null; }

    if (!txs.length) {
      $('volTotal').textContent = '0';
      return;
    }

    const volBuckets = toVolumeBuckets(txs, bucketMs);
    const totalVol = txs.reduce((sum, t) => sum + (t.amount || 0), 0);
    $('volTotal').textContent = fmtCompact(totalVol);

    const ctx = $('volumeChart').getContext('2d');
    volumeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        datasets: [
          {
            label: 'Mua',
            data: volBuckets.map(b => ({ x: b.x, y: b.buy })),
            backgroundColor: 'rgba(240,97,78,0.55)',
            barPercentage: 0.9,
            categoryPercentage: 0.9
          },
          {
            label: 'Bán',
            data: volBuckets.map(b => ({ x: b.x, y: b.sell })),
            backgroundColor: 'rgba(61,220,132,0.55)',
            barPercentage: 0.9,
            categoryPercentage: 0.9
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141920',
            borderColor: '#1e2631',
            borderWidth: 1,
            titleColor: '#e8edf5',
            bodyColor: '#e8edf5',
            padding: 8,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: timeUnit },
            stacked: true,
            grid: { display: false },
            ticks: { display: false }
          },
          y: {
            stacked: true,
            grid: { color: '#141920' },
            ticks: { color: '#4a5568', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 3, callback: v => fmtCompact(v) }
          }
        }
      }
    });
  } catch (e) {
    console.error('renderVolumeChart:', e);
  }
}

function updateChartInfo(item) {
  item = item || allItems.find(i => i.material === selectedMaterial);
  if (!item) return;

  const pct = item.buy_change_pct || 0;
  const cls = chgClass(pct);

  $('cName').textContent = item.display_name || item.material;
  $('cPrice').textContent = fmtUSD(item.current_buy);
  $('cBadge').textContent = fmtPct(pct);
  $('cBadge').className = `chart-badge ${cls}`;
  $('sBuy').textContent = fmtUSD(item.current_buy);
  $('sSell').textContent = fmtUSD(item.current_sell);
  $('sBought').textContent = fmtNum(item.total_bought);
  $('sSold').textContent = fmtNum(item.total_sold);
}

// ── Range toggle ──────────────────────────────────────────
$('rangeBtns').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  $('rangeBtns').querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  chartHours = parseInt(btn.dataset.h);
  renderChart();
});

// ── Top movers ────────────────────────────────────────────
async function loadTopMovers() {
  if (!currentServer) return;
  try {
    const res = await fetch(`/api/servers/${currentServer}/top-movers?limit=8`);
    const movers = await res.json();
    if (!movers.length) {
      $('topMovers').innerHTML = '<div class="empty">Chưa có dữ liệu</div>';
      return;
    }
    $('topMovers').innerHTML = movers.map((item, i) => {
      const pct = item.buy_change_pct || 0;
      const cls = chgClass(pct);
      return `
        <div class="mover-row">
          <span class="mrank">${i + 1}</span>
          <span class="mname">${item.display_name || item.material}</span>
          <span class="${cls}">${chgArrow(pct)} ${fmtPct(pct)}</span>
        </div>`;
    }).join('');
  } catch (e) { console.error('loadTopMovers:', e); }
}

// ── Recent transactions ───────────────────────────────────
async function loadRecentTx() {
  if (!currentServer) return;
  try {
    const res = await fetch(`/api/servers/${currentServer}/transactions?limit=20`);
    const txs = await res.json();
    if (!txs.length) {
      $('recentTx').innerHTML = '<div class="empty">Chưa có giao dịch nào</div>';
      return;
    }
    $('recentTx').innerHTML = txs.map(tx => {
      const typeClass = tx.type === 'BUY' ? 'buy' : 'sell';
      const typeLabel = tx.type === 'BUY' ? 'MUA' : tx.type === 'SELL' ? 'BÁN' : tx.type;
      const time = new Date(tx.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="tx-row">
          <span class="tx-badge ${typeClass}">${typeLabel}</span>
          <span class="tx-meta">${tx.material} ×${tx.amount}</span>
          <span class="tx-time">${time}</span>
        </div>`;
    }).join('');
  } catch (e) { console.error('loadRecentTx:', e); }
}

// ── Admin modal ───────────────────────────────────────────
const overlay = $('overlay');
const loginModal = $('loginModal');
const priceModal = $('priceModal');

$('adminFab').addEventListener('click', () => {
  overlay.classList.add('show');
  if (adminToken) { loginModal.style.display = 'none'; priceModal.style.display = 'block'; }
  else { loginModal.style.display = 'block'; priceModal.style.display = 'none'; }
});

$('cancelLogin').addEventListener('click', () => overlay.classList.remove('show'));
$('cancelPrice').addEventListener('click', () => overlay.classList.remove('show'));
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });

$('doLogin').addEventListener('click', async () => {
  const pwd = $('adminPwd').value;
  $('loginErr').textContent = '';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token;
      $('adminPwd').value = '';
      loginModal.style.display = 'none';
      priceModal.style.display = 'block';
    } else {
      $('loginErr').textContent = data.error || 'Sai mật khẩu';
    }
  } catch { $('loginErr').textContent = 'Lỗi kết nối'; }
});

function populatePriceSelect() {
  $('priceItem').innerHTML = allItems.map(item =>
    `<option value="${item.material}">${item.display_name || item.material}</option>`
  ).join('');
}

$('doSetPrice').addEventListener('click', async () => {
  const material = $('priceItem').value;
  const buyPrice = parseFloat($('newBuy').value);
  const sellPrice = parseFloat($('newSell').value);
  $('priceErr').textContent = '';

  if (isNaN(buyPrice) || isNaN(sellPrice)) {
    $('priceErr').textContent = 'Vui lòng nhập giá hợp lệ';
    return;
  }

  try {
    const res = await fetch('/api/admin/set-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': adminToken },
      body: JSON.stringify({ serverId: currentServer, material, buyPrice, sellPrice })
    });
    const data = await res.json();
    if (res.ok) {
      overlay.classList.remove('show');
      loadItems();
    } else {
      $('priceErr').textContent = data.error || 'Lỗi cập nhật';
    }
  } catch { $('priceErr').textContent = 'Lỗi kết nối'; }
});

// ── Init ──────────────────────────────────────────────────
loadServers();
setInterval(loadServers, 30000);
setInterval(() => {
  if (currentServer) {
    loadTopMovers();
    loadRecentTx();
  }
}, 10000);
