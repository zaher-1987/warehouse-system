const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./warehouse.db');

// Create Users Table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT
  )
`);

// Create Warehouses Table
db.run(`
  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    country TEXT
  )
`);

// Create Items Table
db.run(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT,
    name TEXT,
    type TEXT,
    mg TEXT,
    made_date TEXT,
    warehouse_id INTEGER,
    quantity INTEGER,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  )
`);

// Create Tickets Table
db.run(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER,
    item_id TEXT,
    quantity INTEGER,
    request_date TEXT,
    collect_date TEXT,
    status TEXT,
    production_note TEXT,
    created_by TEXT,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  )
`);
// Add production update fields to existing tickets table
db.run(`ALTER TABLE tickets ADD COLUMN available_quantity INTEGER`, () => {});
db.run(`ALTER TABLE tickets ADD COLUMN balance_needed INTEGER`, () => {});
db.run(`ALTER TABLE tickets ADD COLUMN time_needed TEXT`, () => {});
db.run(`ALTER TABLE tickets ADD COLUMN expected_ready TEXT`, () => {});
db.run(`ALTER TABLE tickets ADD COLUMN actual_ready TEXT`, () => {});

module.exports = db;
