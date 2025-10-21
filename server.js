
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

app.get('/login', (req, res) => {
  res.redirect('/login.html');
});

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
  if (req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
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
// ✅ Add this route BELOW your existing /warehouses GET and POST routes in server.js

app.post('/add-warehouse', requireAdmin, (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Warehouse name is required.' });
  }

  const trimmed = name.trim();
  const existing = warehouses.find(w => w.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return res.status(400).json({ success: false, message: 'Warehouse already exists.' });
  }

  const newId = warehouses.length ? Math.max(...warehouses.map(w => w.id)) + 1 : 1;
  const newWarehouse = { id: newId, name: trimmed };
  warehouses.push(newWarehouse);
  writeJson(WAREHOUSE_FILE, warehouses);

  console.log('✅ Added new warehouse:', newWarehouse);
  res.json({ success: true });
});
// Items
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

// ✅ Admin-only item update
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

// ✅ Ticket Routes (Fixed: include warehouse_name)
app.get('/tickets', (req, res) => {
  const enrichedTickets = tickets.map(ticket => {
    // Handle two possible formats: old "warehouse" string OR warehouse_id
    const warehouse =
      ticket.warehouse_id
        ? warehouses.find(w => w.id === ticket.warehouse_id)
        : warehouses.find(w => w.name === ticket.warehouse);

    return {
      ...ticket,
      warehouse_name: warehouse ? warehouse.name : 'Unknown'
    };
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

// ✅ Inventory Status
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
        const percent = (item.quantity / mainQty) * 100;
        if (percent <= 10) status = 'red';
        else if (percent <= 60) status = 'orange';
        else status = 'green';
      } else if (item.warehouse_id === mainWarehouse.id) {
        status = 'green';
      }

      return {
        warehouse_name: warehouse?.name || '-',
        item_id: item.item_id,
        name: item.name,
        quantity: item.quantity,
        status
      };
    });

  res.json(statusData);
});

// ✅ Auto-ticket generation logic
function checkAutoTicketLogic() {
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.item_id]) grouped[item.item_id] = [];
    grouped[item.item_id].push(item);
  });

  const mainWarehouse = warehouses.find(w => w.name.toLowerCase().includes('main'));
  if (!mainWarehouse) return;

  const mainId = mainWarehouse.id;

  Object.entries(grouped).forEach(([itemId, group]) => {
    const mainItem = group.find(i => i.warehouse_id === mainId);
    if (!mainItem) return;

    group.forEach(i => {
      if (i.warehouse_id !== mainId) {
        const percent = (i.quantity / mainItem.quantity) * 100;
        const wh = warehouses.find(w => w.id === i.warehouse_id);
        if (!wh) return;

        const urgent = percent <= 20;

        if (percent <= 60 && !tickets.some(t => t.item_id === itemId && t.warehouse === wh.name)) {
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

// Redirect root URL to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ✅ Start Server
checkAutoTicketLogic();
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
