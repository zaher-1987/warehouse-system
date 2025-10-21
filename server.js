const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'super-secret-key',
  resave: false,
  saveUninitialized: true
}));

// ✅ JSON file paths
const WAREHOUSE_FILE = 'data/warehouses.json';
const ITEM_FILE = 'data/items.json';
const TICKET_FILE = 'data/tickets.json';
const USERS_FILE = 'data/users.json';

// ✅ Read/Write Helpers
function readJson(file) {
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file);
  return JSON.parse(data);
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ✅ Load data
let warehouses = readJson(WAREHOUSE_FILE);
let items = readJson(ITEM_FILE);
let tickets = readJson(TICKET_FILE);
let users = readJson(USERS_FILE);

// ===================== 🌐 AUTH =====================

app.get('/login', (req, res) => res.redirect('/login.html'));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const found = users.find(u => u.username === username && u.password === password);
  if (!found) {
    return res.send('❌ Invalid credentials. <a href="/login.html">Try again</a>');
  }
  req.session.user = {
    username: found.username,
    role: found.role,
    warehouse_id: found.warehouse_id || null,
    warehouse_name: warehouses.find(w => w.id === found.warehouse_id)?.name || null
  };
  console.log(`🔐 ${found.username} logged in as ${found.role}`);
  res.redirect('/dashboard.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.get('/session-status', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).send('❌ Admins only. <a href="/login.html">Login</a>');
}

// ===================== 🌐 ROUTES =====================

// Warehouses
app.get('/warehouses', (req, res) => res.json(warehouses));

app.post('/warehouses', (req, res) => {
  const newId = warehouses.length ? warehouses[warehouses.length - 1].id + 1 : 1;
  const newWarehouse = { id: newId, ...req.body };
  warehouses.push(newWarehouse);
  writeJson(WAREHOUSE_FILE, warehouses);
  res.status(201).json(newWarehouse);
});

// ✅ Add new warehouse
app.post('/add-warehouse', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Warehouse name required.' });
  }
  const trimmed = name.trim();
  if (warehouses.find(w => w.name.toLowerCase() === trimmed.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Warehouse already exists.' });
  }
  const newId = warehouses.length ? Math.max(...warehouses.map(w => w.id)) + 1 : 1;
  const newWarehouse = { id: newId, name: trimmed };
  warehouses.push(newWarehouse);
  writeJson(WAREHOUSE_FILE, warehouses);
  console.log('✅ Added new warehouse:', newWarehouse);
  res.json({ success: true });
});

// ===================== ITEMS =====================

app.get('/items', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);
  if (user.role === 'admin') return res.json(items);
  const filtered = items.filter(i => i.warehouse_id === user.warehouse_id);
  res.json(filtered);
});

app.post('/items', (req, res) => {
  const newId = items.length ? items.length + 1 : 1;
  const newItem = { id: newId, ...req.body };
  items.push(newItem);
  writeJson(ITEM_FILE, items);
  res.status(201).json(newItem);
});

// ✅ Update Item (admin only)
app.post('/update-item', requireAdmin, (req, res) => {
  try {
    const { warehouse, item_id, name, quantity } = req.body;
    const warehouseObj = warehouses.find(w => w.name === warehouse);
    if (!warehouseObj) return res.json({ success: false, message: 'Warehouse not found' });

    const index = items.findIndex(i => i.item_id === item_id && i.warehouse_id === warehouseObj.id);
    if (index === -1) return res.json({ success: false, message: 'Item not found' });

    items[index].name = name;
    items[index].quantity = quantity;
    writeJson(ITEM_FILE, items);

    checkAutoTicketLogic();
    console.log(`✅ Updated ${item_id} in ${warehouse}: ${quantity}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Update error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// ===================== TICKETS =====================

app.get('/tickets', (req, res) => {
  const enrichedTickets = tickets.map(ticket => {
    const warehouse =
      ticket.warehouse_id
        ? warehouses.find(w => w.id === ticket.warehouse_id)
        : warehouses.find(w => w.name === ticket.warehouse);
    return { ...ticket, warehouse_name: warehouse ? warehouse.name : 'Unknown' };
  });
  res.json(enrichedTickets);
});

app.post('/tickets', (req, res) => {
  const newId = tickets.length ? tickets.length + 1 : 1;
  const newTicket = { id: newId, ...req.body };
  tickets.push(newTicket);
  writeJson(TICKET_FILE, tickets);
  res.status(201).json(newTicket);
});

// ✅ Update ticket status (Admin or Main Warehouse)
app.post('/update-ticket-status', (req, res) => {
  const { id, expected_ready, actual_ready, delay_reason } = req.body;
  const user = req.session.user;
  if (!user || !(user.role === 'admin' || (user.warehouse_name && user.warehouse_name.toLowerCase().includes('main')))) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const idx = tickets.findIndex(t => t.id === Number(id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Ticket not found' });

  if (expected_ready) tickets[idx].expected_ready = expected_ready;
  if (actual_ready) tickets[idx].actual_ready = actual_ready;
  if (delay_reason) tickets[idx].delay_reason = delay_reason;

  writeJson(TICKET_FILE, tickets);
  console.log(`✅ Ticket #${id} updated by ${user.username}`);
  res.json({ success: true, ticket: tickets[idx] });
});

// ===================== INVENTORY =====================

app.get('/inventory-status', (req, res) => {
  const mainWarehouse = warehouses.find(w => w.name.toLowerCase().includes('main'));
  if (!mainWarehouse) return res.json([]);
  const user = req.session.user;
  const userWarehouseId = user?.warehouse_id || null;
  const isAdmin = user?.role === 'admin';

  const statusData = items
    .filter(item => isAdmin || item.warehouse_id === userWarehouseId)
    .map(item => {
      const warehouse = warehouses.find(w => w.id === item.warehouse_id);
      const mainItem = items.find(i => i.item_id === item.item_id && i.warehouse_id === mainWarehouse.id);
      const mainQty = mainItem ? mainItem.quantity : 0;
      let status = 'unknown';
      if (item.warehouse_id !== mainWarehouse.id && mainQty > 0) {
        const pct = (item.quantity / mainQty) * 100;
        if (pct <= 10) status = 'red';
        else if (pct <= 60) status = 'orange';
        else status = 'green';
      } else if (item.warehouse_id === mainWarehouse.id) status = 'green';
      return { warehouse_name: warehouse?.name || '-', item_id: item.item_id, name: item.name, quantity: item.quantity, status };
    });
  res.json(statusData);
});

// ===================== AUTO-TICKET =====================

function checkAutoTicketLogic() {
  const grouped = {};
  items.forEach(i => {
    if (!grouped[i.item_id]) grouped[i.item_id] = [];
    grouped[i.item_id].push(i);
  });
  const mainWarehouse = warehouses.find(w => w.name.toLowerCase().includes('main'));
  if (!mainWarehouse) return;
  const mainId = mainWarehouse.id;

  Object.entries(grouped).forEach(([itemId, group]) => {
    const mainItem = group.find(i => i.warehouse_id === mainId);
    if (!mainItem) return;
    group.forEach(i => {
      if (i.warehouse_id !== mainId) {
        const pct = (i.quantity / mainItem.quantity) * 100;
        const wh = warehouses.find(w => w.id === i.warehouse_id);
        if (!wh) return;
        const urgent = pct <= 20;
        if (pct <= 60 && !tickets.some(t => t.item_id === itemId && t.warehouse === wh.name)) {
          tickets.push({
            id: tickets.length ? tickets.length + 1 : 1,
            warehouse_id: wh.id,
            warehouse: wh.name,
            item_id: itemId,
            quantity: mainItem.quantity,
            request_date: new Date().toISOString().split('T')[0],
            collect_date: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
            status: urgent ? 'URGENT' : 'PENDING',
            created_by: 'auto-system'
          });
        }
      }
    });
  });
  writeJson(TICKET_FILE, tickets);
}

// Root
app.get('/', (req, res) => res.redirect('/login.html'));

checkAutoTicketLogic();
app.get('/production-view.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'production-view.html'));
});
app.post('/send-stock', async (req, res) => {
  const { from, to, item_id, quantity, request_date, collect_date } = req.body;
  const itemsPath = path.join(__dirname, 'data', 'items.json');
  const ticketsPath = path.join(__dirname, 'data', 'tickets.json');

  try {
    const items = JSON.parse(await fs.readFile(itemsPath, 'utf-8'));
    const tickets = JSON.parse(await fs.readFile(ticketsPath, 'utf-8'));

    // Find item in Main Warehouse
    const itemIndex = items.findIndex(i => i.warehouse_name === from && i.item_id === item_id);
    if (itemIndex === -1) return res.json({ success: false, message: 'Item not found in main warehouse.' });

    const item = items[itemIndex];

    // Check enough stock
    if (item.quantity < quantity) {
      return res.json({ success: false, message: 'Not enough stock in main warehouse.' });
    }

    // Subtract stock
    items[itemIndex].quantity -= quantity;
    await fs.writeFile(itemsPath, JSON.stringify(items, null, 2));

    // Add ticket
    const newTicket = {
      id: Date.now().toString(),
      item_id,
      name: item.name,
      quantity,
      from,
      to,
      request_date,
      collect_date,
      status: "Pending",
      expected_ready: "",
      actual_ready: "",
      delay_reason: ""
    };
    tickets.push(newTicket);
    await fs.writeFile(ticketsPath, JSON.stringify(tickets, null, 2));

    res.json({ success: true, ticket: newTicket });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
