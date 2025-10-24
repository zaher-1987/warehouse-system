const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const fs = require("fs").promises;
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "super-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);

// ✅ JSON file paths
const WAREHOUSE_FILE = "data/warehouses.json";
const ITEM_FILE = "data/items.json";
const TICKET_FILE = "data/tickets.json";
const USERS_FILE = "data/users.json";

// ✅ Helpers
async function readJson(file) {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ===================== AUTH =====================
app.get("/login", (req, res) => res.redirect("/login.html"));

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const users = await readJson(USERS_FILE);
  const warehouses = await readJson(WAREHOUSE_FILE);

  const found = users.find(
    (u) => u.username === username && u.password === password
  );

  if (!found)
    return res.send("❌ Invalid credentials. <a href='/login.html'>Try again</a>");

  req.session.user = {
    username: found.username,
    role: found.role,
    warehouse_id: found.warehouse_id || null,
    warehouse_name:
      warehouses.find((w) => w.id === found.warehouse_id)?.name || null,
  };

  console.log(`🔐 ${found.username} logged in as ${found.role}`);
  res.redirect("/dashboard.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

app.get("/session-status", (req, res) => {
  if (req.session.user)
    return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") return next();
  return res.status(403).send("❌ Admins only. <a href='/login.html'>Login</a>");
}

// ===================== ROUTES =====================

// ✅ Warehouses
app.get("/warehouses", async (req, res) => {
  const warehouses = await readJson(WAREHOUSE_FILE);
  res.json(warehouses);
});

app.post("/add-warehouse", requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim())
    return res
      .status(400)
      .json({ success: false, message: "Warehouse name required." });

  const warehouses = await readJson(WAREHOUSE_FILE);
  if (warehouses.find((w) => w.name.toLowerCase() === name.toLowerCase()))
    return res
      .status(400)
      .json({ success: false, message: "Warehouse already exists." });

  const newWarehouse = { id: Date.now(), name: name.trim() };
  warehouses.push(newWarehouse);
  await writeJson(WAREHOUSE_FILE, warehouses);

  console.log("✅ Added new warehouse:", newWarehouse);
  res.json({ success: true });
});

// ✅ Items route (Main Warehouse can see all)
app.get("/items", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);

  const items = await readJson(ITEM_FILE);
  const warehouses = await readJson(WAREHOUSE_FILE);

  // Main warehouse (ID 1) and Admins can see all
  if (user.warehouse_id === 1 || user.role === "admin") {
    const enriched = items.map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      return { ...item, warehouse_name: warehouse?.name || "-" };
    });
    return res.json(enriched);
  }

  // Other warehouse users only see their own
  const filtered = items
    .filter((i) => i.warehouse_id === user.warehouse_id)
    .map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      return { ...item, warehouse_name: warehouse?.name || "-" };
    });

  res.json(filtered);
});

// ✅ Tickets
app.get("/tickets", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);

  const tickets = await readJson(TICKET_FILE);
  res.json(tickets);
});

// ✅ Inventory Status + Auto Ticket Logic for Production
app.get("/inventory-status", async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(403).json({ error: "Not authenticated" });

    const items = await readJson(ITEM_FILE);
    const tickets = await readJson(TICKET_FILE);
    const warehouses = await readJson(WAREHOUSE_FILE);
    let updated = false;

    const result = items.map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      const warehouse_name = warehouse ? warehouse.name : "Unknown";

      let status = "unknown";
      if (warehouse.id !== 1) {
        const mainItem = items.find(
          (i) => i.item_id === item.item_id && i.warehouse_id === 1
        );
        if (mainItem && mainItem.quantity > 0) {
          const percent = (item.quantity / mainItem.quantity) * 100;
          if (percent <= 10) status = "red";
          else if (percent <= 60) status = "orange";
          else status = "green";
        }
      } else {
        const percent = item.quantity / 1000;
        if (percent <= 0.1) status = "red";
        else if (percent <= 0.6) status = "orange";
        else status = "green";

        // 🧠 Auto-ticket to Production if stock is RED and no open ticket exists
        const hasTicket = tickets.some(
          (t) => t.item_id === item.item_id && t.to === "Production" && t.status === "open"
        );
        if (status === "red" && !hasTicket) {
          const ticket = {
            id: Date.now(),
            from: "Main Warehouse",
            to: "Production",
            item_id: item.item_id,
            quantity: item.quantity,
            status: "open",
            created_at: new Date().toISOString(),
          };
          tickets.push(ticket);
          updated = true;
          console.log("🛠️ Auto-ticket sent to Production:", ticket);
        }
      }

      return {
        warehouse_name,
        item_id: item.item_id,
        name: item.name,
        quantity: item.quantity,
        status,
      };
    });

    if (updated) await writeJson(TICKET_FILE, tickets);
    res.json(result);
  } catch (err) {
    console.error("❌ Failed to load inventory:", err);
    res.status(500).json({ error: "Failed to load inventory data" });
  }
});

// ✅ Start server
app.get("/", (req, res) => res.redirect("/login.html"));

// ✅ Run server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
