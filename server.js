const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'super-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);

// ✅ JSON file paths
const WAREHOUSE_FILE = 'data/warehouses.json';
const ITEM_FILE = 'data/items.json';
const TICKET_FILE = 'data/tickets.json';
const USERS_FILE = 'data/users.json';

// ✅ Read/Write Helpers
async function readJson(file) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ===================== 🌐 AUTH =====================
app.get('/login', (req, res) => res.redirect('/login.html'));

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readJson(USERS_FILE);
  const warehouses = await readJson(WAREHOUSE_FILE);
  const found = users.find(
    (u) => u.username === username && u.password === password
  );
  if (!found)
    return res.send('❌ Invalid credentials. <a href="/login.html">Try again</a>');

  req.session.user = {
    username: found.username,
    role: found.role,
    warehouse_id: found.warehouse_id || null,
    warehouse_name: warehouses.find((w) => w.id === found.warehouse_id)?.name || null,
  };

  console.log(`🔐 ${found.username} logged in as ${found.role}`);
  res.redirect('/dashboard.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.get('/session-status', (req, res) => {
  if (req.session.user)
    return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).send('❌ Admins only. <a href="/login.html">Login</a>');
}

// ===================== 🌐 ROUTES =====================

// ✅ Warehouses
app.get('/warehouses', async (req, res) => {
  const warehouses = await readJson(WAREHOUSE_FILE);
  res.json(warehouses);
});

app.post('/add-warehouse', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ success: false, message: 'Warehouse name required.' });

  const warehouses = await readJson(WAREHOUSE_FILE);
  if (warehouses.find((w) => w.name.toLowerCase() === name.toLowerCase()))
    return res.status(400).json({ success: false, message: 'Warehouse already exists.' });

  const newWarehouse = { id: Date.now(), name: name.trim() };
  warehouses.push(newWarehouse);
  await writeJson(WAREHOUSE_FILE, warehouses);

  console.log('✅ Added new warehouse:', newWarehouse);
  res.json({ success: true });
});

// ✅ Items
app.get('/items', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);

  const items = await readJson(ITEM_FILE);
  if (user.role === 'admin') return res.json(items);
  const filtered = items.filter((i) => i.warehouse_id === user.warehouse_id);
  res.json(filtered);
});

app.post('/update-item', requireAdmin, async (req, res) => {
  try {
    const { warehouse, item_id, name, quantity } = req.body;
    const warehouses = await readJson(WAREHOUSE_FILE);
    const items = await readJson(ITEM_FILE);

    const warehouseObj = warehouses.find((w) => w.name === warehouse);
    if (!warehouseObj) return res.json({ success: false, message: 'Warehouse not found' });

    const index = items.findIndex(
      (i) => i.item_id === item_id && i.warehouse_id === warehouseObj.id
    );
    if (index === -1)
      return res.json({ success: false, message: 'Item not found' });

    items[index].name = name;
    items[index].quantity = quantity;
    await writeJson(ITEM_FILE, items);

    console.log(`✅ Updated ${item_id} in ${warehouse}: ${quantity}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Update error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// ✅ Tickets
app.get('/tickets', async (req, res) => {
  const warehouses = await readJson(WAREHOUSE_FILE);
  const tickets = await readJson(TICKET_FILE);

  const enriched = tickets.map((t) => {
    const warehouse =
      t.warehouse_id
        ? warehouses.find((w) => w.id === t.warehouse_id)
        : warehouses.find((w) => w.name === t.warehouse);
    return { ...t, warehouse_name: warehouse ? warehouse.name : 'Unknown' };
  });

  res.json(enriched);
});

app.post('/update-ticket-status', async (req, res) => {
  const { id, expected_ready, actual_ready, delay_reason } = req.body;
  const user = req.session.user;
  if (
    !user ||
    !(
      user.role === 'admin' ||
      (user.warehouse_name &&
        user.warehouse_name.toLowerCase().includes('main'))
    )
  ) {
    return res
      .status(403)
      .json({ success: false, message: 'Not authorized' });
  }

  const tickets = await readJson(TICKET_FILE);
  const idx = tickets.findIndex((t) => t.id === id);
  if (idx === -1)
    return res.status(404).json({ success: false, message: 'Ticket not found' });

  if (expected_ready) tickets[idx].expected_ready = expected_ready;
  if (actual_ready) tickets[idx].actual_ready = actual_ready;
  if (delay_reason) tickets[idx].delay_reason = delay_reason;

  await writeJson(TICKET_FILE, tickets);
  console.log(`✅ Ticket #${id} updated by ${user.username}`);
  res.json({ success: true, ticket: tickets[idx] });
});

// ✅ Send stock route
app.post('/send-stock', async (req, res) => {
  const { from, to, item_id, quantity, request_date, collect_date } = req.body;

  try {
    const items = await readJson(ITEM_FILE);
    const tickets = await readJson(TICKET_FILE);

    // Find item in main warehouse
    const item = items.find(
      (i) => i.item_id === item_id && i.warehouse_name === from
    );
    if (!item)
      return res.json({ success: false, message: 'Item not found in main warehouse.' });

    if (item.quantity < quantity)
      return res.json({ success: false, message: 'Not enough stock in main warehouse.' });

    // Deduct stock
    item.quantity -= quantity;
    await writeJson(ITEM_FILE, items);

    // Create ticket
    const newTicket = {
      id: Date.now().toString(),
      from,
      to,
      item_id,
      name: item.name,
      quantity,
      request_date,
      collect_date,
      status: 'Pending',
      expected_ready: '',
      actual_ready: '',
      delay_reason: '',
      created_by: req.session.user?.username || 'system',
    };
    tickets.push(newTicket);
    await writeJson(TICKET_FILE, tickets);

    console.log(`📦 Stock sent from ${from} → ${to}: ${item_id} (${quantity})`);
    res.json({ success: true, ticket: newTicket });
  } catch (err) {
    console.error('❌ Error in /send-stock:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ✅ Root & Production view
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/production-view.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'production-view.html'));
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
