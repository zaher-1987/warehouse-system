// ✅ server.js (with CSV Export Support)

const express = require("express");
const bodyParser = require("body-parser");
const session = require("express-session");
const fs = require("fs").promises;
const path = require("path");
const { Parser } = require("json2csv"); // ✅ Added for CSV export

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

// ✅ Export inventory as CSV
app.get("/export/inventory", async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "admin") return res.status(403).send("Forbidden");

  const data = await readJson(ITEM_FILE);
  const parser = new Parser();
  const csv = parser.parse(data);

  res.header("Content-Type", "text/csv");
  res.attachment("inventory.csv");
  res.send(csv);
});

// ✅ Export tickets as CSV
app.get("/export/tickets", async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "admin") return res.status(403).send("Forbidden");

  const data = await readJson(TICKET_FILE);
  const parser = new Parser();
  const csv = parser.parse(data);

  res.header("Content-Type", "text/csv");
  res.attachment("tickets.csv");
  res.send(csv);
});

// ✅ Root routes
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/production-view.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "production-view.html"));
});

// ✅ Start server
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
