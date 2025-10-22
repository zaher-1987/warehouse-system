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

// ✅ Items
app.get("/items", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);

  const items = await readJson(ITEM_FILE);
  const warehouses = await readJson(WAREHOUSE_FILE);

  if (user.role === "admin") {
    const enriched = items.map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      return { ...item, warehouse_name: warehouse?.name || "-" };
    });
    return res.json(enriched);
  }

  const filtered = items.filter((i) => i.warehouse_id === user.warehouse_id);
  res.json(filtered);
});

// 📦 Return inventory items with warehouse name + status
app.get("/inventory-status", async (req, res) => {
  try {
    const items = await readJson(ITEM_FILE);
    const warehouses = await readJson(WAREHOUSE_FILE);

    if (!Array.isArray(items) || !Array.isArray(warehouses)) {
      return res.status(500).json({ error: "Data format error" });
    }

    const mainWarehouse = warehouses.find((w) =>
      w.name.toLowerCase().includes("main")
    );
    if (!mainWarehouse) return res.json([]);

    const result = items.map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      const warehouse_name = warehouse ? warehouse.name : "Unknown";

      let status = "unknown";
      if (warehouse_name !== "Main Warehouse") {
        const mainItem = items.find(
          (i) => i.item_id === item.item_id && i.warehouse_id === mainWarehouse.id
        );
        if (mainItem && mainItem.quantity > 0) {
          const percent = (item.quantity / mainItem.quantity) * 100;
          if (percent <= 10) status = "red";
          else if (percent <= 60) status = "orange";
          else status = "green";
        }
      } else {
        status = "green";
      }

      return {
        warehouse_name,
        item_id: item.item_id,
        name: item.name,
        quantity: item.quantity,
        status,
      };
    });

    console.log("✅ /inventory-status returned", result.length, "items");
    res.json(result);
  } catch (err) {
    console.error("❌ Failed to load inventory:", err);
    res.status(500).json({ error: "Failed to load inventory data" });
  }
});

// ✅ Update quantities
app.post("/update-quantities", requireAdmin, async (req, res) => {
  try {
    const updates = req.body;
    const warehouses = await readJson(WAREHOUSE_FILE);
    const items = await readJson(ITEM_FILE);

    updates.forEach((update) => {
      const warehouseObj = warehouses.find(
        (w) => w.name === update.warehouse_name
      );
      if (!warehouseObj) return;

      const item = items.find(
        (i) => i.item_id === update.item_id && i.warehouse_id === warehouseObj.id
      );
      if (item) {
        item.quantity = parseInt(update.quantity);
      }
    });

    await writeJson(ITEM_FILE, items);
    console.log(`✅ Updated ${updates.length} item quantities.`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Failed to update quantities:", err);
    res.status(500).json({ success: false, message: "Error updating items" });
  }
});

// ✅ Send stock route
app.post("/send-stock", async (req, res) => {
  try {
    const { from, to, item_id, quantity, request_date, collect_date } =
      req.body;

    const warehouses = await readJson(WAREHOUSE_FILE);
    const items = await readJson(ITEM_FILE);
    const tickets = await readJson(TICKET_FILE);

    const mainWarehouse = warehouses.find((w) =>
      w.name.toLowerCase().includes("main")
    );
    const toWarehouse = warehouses.find(
      (w) => w.name.toLowerCase() === to.toLowerCase()
    );

    if (!mainWarehouse)
      return res.json({ success: false, message: "Main warehouse not found." });

    const mainItem = items.find(
      (i) => i.item_id === item_id && i.warehouse_id === mainWarehouse.id
    );
    if (!mainItem)
      return res.json({
        success: false,
        message: "Item not found in main warehouse.",
      });

    if (mainItem.quantity < quantity)
      return res.json({
        success: false,
        message: "Not enough stock in main warehouse.",
      });

    mainItem.quantity -= quantity;

    let targetItem = items.find(
      (i) => i.item_id === item_id && i.warehouse_id === toWarehouse.id
    );
    if (targetItem) {
      targetItem.quantity += quantity;
    } else {
      items.push({
        warehouse_id: toWarehouse.id,
        item_id,
        name: mainItem.name,
        quantity,
      });
    }

    await writeJson(ITEM_FILE, items);

    const newTicket = {
      id: Date.now(),
      from_warehouse: from,
      to_warehouse: to,
      item_id,
      name: mainItem.name,
      quantity,
      request_date,
      collect_date,
      status: "Pending",
      expected_ready: "",
      actual_ready: "",
      delay_reason: "",
      created_by: req.session.user?.username || "system",
    };

    tickets.push(newTicket);
    await writeJson(TICKET_FILE, tickets);

    console.log(`📦 Sent ${quantity} of ${item_id} from ${from} → ${to}`);
    res.json({ success: true, ticket: newTicket });
  } catch (err) {
    console.error("❌ Error in /send-stock:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Root
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/production-view.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "production-view.html"));
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
