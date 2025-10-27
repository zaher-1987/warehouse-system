const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const fs = require("fs").promises;
const path = require("path");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ EasyStore credentials
const EASYSTORE_APP_ID = "app56223ac627daadd8";
const EASYSTORE_APP_SECRET = "f4081a59e248d3d2b5e7e830daff3e62";
const REDIRECT_URI = "https://warehouse-system-1.onrender.com/easystore/callback";
let easystoreAccessToken = null; // will be set after OAuth success

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

// ===================== WAREHOUSE ROUTES =====================
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

// ===================== ITEMS =====================
app.get("/items", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);

  const items = await readJson(ITEM_FILE);
  const warehouses = await readJson(WAREHOUSE_FILE);

  if (user.warehouse_id === 1 || user.role === "admin") {
    const enriched = items.map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      return { ...item, warehouse_name: warehouse?.name || "-" };
    });
    return res.json(enriched);
  }

  const filtered = items
    .filter((i) => i.warehouse_id === user.warehouse_id)
    .map((item) => {
      const warehouse = warehouses.find((w) => w.id === item.warehouse_id);
      return { ...item, warehouse_name: warehouse?.name || "-" };
    });

  res.json(filtered);
});

// ===================== TICKETS =====================
app.get("/tickets", async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(403).json([]);
  const tickets = await readJson(TICKET_FILE);
  res.json(tickets);
});

// ===================== INVENTORY STATUS =====================
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

        const hasTicket = tickets.some(
          (t) =>
            t.item_id === item.item_id &&
            t.to === "Production" &&
            t.status === "open"
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

// ===================== EASYSTORE OAUTH =====================

// Step 1: Redirect user to EasyStore OAuth authorization
app.get("/easystore/install", (req, res) => {
  const url = `https://accounts.easystore.com/oauth/authorize?client_id=${EASYSTORE_APP_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code`;
  console.log("🔗 Redirecting to EasyStore:", url);
  res.redirect(url);
});

// Step 2: Handle OAuth callback and exchange code for access token
app.get("/easystore/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("❌ Missing authorization code");

  try {
    const response = await fetch("https://accounts.easystore.co/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: EASYSTORE_APP_ID,
        client_secret: EASYSTORE_APP_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));

    easystoreAccessToken = data.access_token;
    console.log("✅ EasyStore access token:", easystoreAccessToken);
    res.send(
      "✅ EasyStore App connected! Now visit <a href='/easystore/products'>/easystore/products</a>"
    );
  } catch (err) {
    console.error("❌ OAuth Error:", err);
    res.status(500).send("OAuth exchange failed");
  }
});

// Step 3: Use the authorized token to fetch products
app.get("/easystore/products", async (req, res) => {
  if (!easystoreAccessToken)
    return res
      .status(401)
      .send("❌ EasyStore not connected. Please visit /easystore/install first.");

  try {
    const response = await fetch("https://api.easystore.com/api/v3/products.json", {
      headers: {
        Authorization: `Bearer ${easystoreAccessToken}`,
        Accept: "application/json",
      },
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("❌ EasyStore API error:", data);
      return res.status(response.status).json(data);
    }

    console.log(`✅ Synced ${data.products?.length || 0} products from EasyStore`);
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching EasyStore products:", err);
    res.status(500).send("Error fetching EasyStore products");
  }
});

// ===================== SERVER START =====================
app.get("/", (req, res) => res.redirect("/login.html"));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
