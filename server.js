// ✅ server.js — Final Stable Version with Edit & Status Logic
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ JSON file paths
const WAREHOUSE_FILE = 'data/warehouses.json';
const ITEM_FILE = 'data/items.json';
const TICKET_FILE = 'data/tickets.json';

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

// 🌐 ROUTES

// Warehouses
app.get('/warehouses', (req, res) => res.json(warehouses));
app.post('/warehouses', (req, res) => {
  const newId = warehouses.length ? warehouses[warehouses.length - 1].id + 1 : 1;
  const newWarehouse = { id: newId, ...req.body };
  warehouses.push(newWarehouse);
  writeJson(WAREHOUSE_FILE, warehouses);
  res.status(201).json(newWarehouse);
});

// Items
app.get('/items', (req, res) => res.json(items));
app.post('/items', (req, res) => {
  const newId = items.length ? items[items.length - 1].id + 1 : 1;
  const newItem = { id: newId, ...req.body };
  items.push(newItem);
  writeJson(ITEM_FILE, items);
  res.status(201).json(newItem);
});

// Tickets
app.get('/tickets', (req, res) => res.json(tickets));
app.post('/tickets', (req, res) => {
  const newId = tickets.length ? tickets[tickets.length - 1].id + 1 : 1;
  const newTicket = { id: newId, ...req.body };
  tickets.push(newTicket);
  writeJson(TICKET_FILE, tickets);
  res.status(201).json(newTicket);
});

// ✅ Inventory Status
app.get('/inventory-status', (req, res) => {
  const statusData = [];
  const mainWarehouse = warehouses.find(w => w.name.toLowerCase().includes('main'));
  if (!mainWarehouse) return res.json([]);

  items.forEach(item => {
    const warehouse = warehouses.find(w => w.id === item.warehouse_id);
    if (!warehouse) return;

    const mainStock = items.find(i => i.item_id === item.item_id && i.warehouse_id === mainWarehouse.id);
    const mainQty = mainStock ? mainStock.quantity : 0;

    let status = 'unknown';
    if (item.warehouse_id !== mainWarehouse.id && mainQty > 0) {
      const percentage = (item.quantity / mainQty) * 100;
      if (percentage <= 10) status = 'red';
      else if (percentage <= 60) status = 'orange';
      else status = 'green';
    } else if (item.warehouse_id === mainWarehouse.id) {
      status = 'green';
    }

    statusData.push({
      warehouse_name: warehouse.name,
      item_id: item.item_id,
      name: item.name || '-',
      quantity: item.quantity,
      status
    });
  });

  res.json(statusData);
});

// ✅ Ticket Helper
function ticketExists(warehouse, itemId) {
  return tickets.some(t => t.warehouse === warehouse && t.item_id === itemId);
}

// ✅ Auto Ticket Logic
function checkAutoTicketLogic() {
  console.log('🔁 Checking stock levels...');
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
    const mainQty = mainItem.quantity;

    group.forEach(i => {
      if (i.warehouse_id !== mainId) {
        const percent = (i.quantity / mainQty) * 100;
        const wh = warehouses.find(w => w.id === i.warehouse_id);
        if (!wh) return;
        const urgent = percent <= 20;

        if (percent <= 60 && !ticketExists(wh.name, itemId)) {
          const today = new Date();
          const collect = new Date(Date.now() + 5 * 86400000);

          tickets.push({
            id: tickets.length ? tickets[tickets.length - 1].id + 1 : 1,
            warehouse: wh.name,
            item_id: itemId,
            quantity: mainQty,
            request_date: today.toISOString().split('T')[0],
            collect_date: collect.toISOString().split('T')[0],
            status: urgent ? 'URGENT' : 'PENDING',
            created_by: 'auto-system'
          });
        }
      }
    });
  });

  writeJson(TICKET_FILE, tickets);
}

// ✅ Update Item and Recalculate Status
app.post('/update-item', (req, res) => {
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

// ✅ Initial run
checkAutoTicketLogic();

// ✅ WIX Webhook Receiver (when order is paid)
app.post('/wix-order-webhook', async (req, res) => {
  try {
    const { site, orderId, items } = req.body;
    console.log(`📦 Received WIX Order #${orderId} from ${site}`);

    const warehouseName = mapWixSiteToWarehouse(site);
    let db = readJson(ITEM_FILE);

    // 🔁 Deduct quantities from that warehouse
    items.forEach(purchased => {
      const item = db.find(i =>
        i.name.trim().toLowerCase() === purchased.name.trim().toLowerCase() &&
        i.warehouse_name === warehouseName
      );
      if (item) {
        item.quantity = Math.max(0, item.quantity - purchased.quantity);
        item.status = getStatus(item.quantity);
        console.log(`🧮 Updated ${item.name}: ${item.quantity} left in ${warehouseName}`);
      }
    });

    // 💾 Save changes
    writeJson(ITEM_FILE, db);

    // 🔔 Auto ticket creation if needed
    checkAutoTicketLogic();

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🧩 Helper functions
function mapWixSiteToWarehouse(siteName) {
  const map = {
    'Indonesia Store': 'Indonesia',
    'Vietnam Store': 'Vietnam',
    'Thailand Store': 'Thailand',
    'India Store': 'India',
    'Japan Store': 'Japan',
    'S.Korea Store': 'S.Korea',
    'Germany Store': 'Germany',
    'USA Store': 'USA',
    'Colombia Store': 'Colombia',
    'Brazil Store': 'Brazil',
    'Philippines Store': 'Philippines'
  };
  return map[siteName] || 'Unknown';
}

function getStatus(qty) {
  if (qty <= 15) return 'red';
  if (qty <= 40) return 'orange';
  return 'green';
}

// ✅ Start server (Render & local both supported)
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));