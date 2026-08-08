const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'carwash.db'));

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'washer', -- washer, manager, admin
  daily_wage REAL NOT NULL DEFAULT 0,
  monthly_salary REAL NOT NULL DEFAULT 0,
  joined_date TEXT,
  aadhaar_number TEXT,
  aadhaar_file TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL, -- present, half_day, absent, paid_leave
  note TEXT,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  payment_method TEXT DEFAULT 'cash'
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  days_present REAL NOT NULL,
  daily_wage REAL NOT NULL,
  gross_pay REAL NOT NULL,
  total_advances REAL NOT NULL,
  net_pay REAL NOT NULL,
  paid_date TEXT,
  UNIQUE(employee_id, month, year)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,
  name TEXT,
  reward_points INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_number TEXT UNIQUE NOT NULL,
  brand TEXT,
  model TEXT,
  segment TEXT, -- hatchback, sedan, mini_suv, suv, scooter, bike
  color TEXT,
  customer_id INTEGER
);

CREATE TABLE IF NOT EXISTS wash_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wash_type_id INTEGER NOT NULL,
  segment TEXT NOT NULL,
  price REAL NOT NULL,
  UNIQUE(wash_type_id, segment)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL DEFAULT 1,
  vehicle_id INTEGER NOT NULL,
  wash_type_id INTEGER NOT NULL,
  entry_time TEXT NOT NULL,
  exit_time TEXT,
  eta_minutes INTEGER DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'in_progress',
  has_chain_lube INTEGER DEFAULT 0,
  chain_lube_price REAL DEFAULT 0,
  customer_type TEXT DEFAULT 'normal',
  workshop_id INTEGER,
  payment_status TEXT DEFAULT 'unsettled'
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER UNIQUE NOT NULL,
  amount REAL NOT NULL,
  discount_amount REAL NOT NULL DEFAULT 0,
  final_amount REAL NOT NULL,
  payment_method TEXT,
  reward_points_earned INTEGER NOT NULL DEFAULT 0,
  reward_points_redeemed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'gpay'
);

CREATE TABLE IF NOT EXISTS daily_opening_balances (
  date TEXT PRIMARY KEY,
  opening_cash REAL NOT NULL DEFAULT 0,
  opening_gpay REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workshops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  type TEXT NOT NULL DEFAULT 'Car Workshop',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workshop_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_id INTEGER,
  wash_type_id INTEGER NOT NULL,
  segment TEXT NOT NULL,
  price REAL NOT NULL,
  UNIQUE(workshop_id, wash_type_id, segment)
);
`);

// Migration for workshops table: owner_name and owner_phone columns
try {
  db.prepare('ALTER TABLE workshops ADD COLUMN owner_name TEXT').run();
} catch (e) {}
try {
  db.prepare('ALTER TABLE workshops ADD COLUMN owner_phone TEXT').run();
} catch (e) {}

// Migrations for existing databases
try { db.exec('ALTER TABLE employees ADD COLUMN aadhaar_number TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE employees ADD COLUMN aadhaar_file TEXT;'); } catch (e) {}
try { db.exec('ALTER TABLE advances ADD COLUMN payment_method TEXT DEFAULT "cash";'); } catch (e) {}
try { db.exec('ALTER TABLE expenses ADD COLUMN payment_method TEXT DEFAULT "gpay";'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN has_chain_lube INTEGER DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN chain_lube_price REAL DEFAULT 0;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN customer_type TEXT DEFAULT "normal";'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN workshop_id INTEGER;'); } catch (e) {}
try { db.exec('ALTER TABLE jobs ADD COLUMN payment_status TEXT DEFAULT "unsettled";'); } catch (e) {}

// Seed branch
const branchCount = db.prepare('SELECT COUNT(*) c FROM branches').get().c;
if (branchCount === 0) {
  db.prepare('INSERT INTO branches (name) VALUES (?)').run('Main Branch');
}

// Seed wash types + exact normal customer pricing
const defaultWashTypes = ['Full Body Wash', 'Body Wash', 'Water Wash', 'Interior & Vacuum', 'Bike / Scooter Wash', 'Chain Lube'];
const carSegments = ['hatchback', 'sedan_compact_suv', 'sedan', 'mini_suv', 'suv', 'premium_hatch', 'premium_sedan_suv', 'muv'];
const bikeSegments = ['bike', 'scooter'];

const normalPricesMap = {
  'Full Body Wash': {
    hatchback: 500,
    sedan_compact_suv: 550,
    sedan: 550,
    mini_suv: 550,
    suv: 650,
    premium_hatch: 600,
    premium_sedan_suv: 650,
    muv: 700
  },
  'Body Wash': {
    hatchback: 350,
    sedan_compact_suv: 400,
    sedan: 400,
    mini_suv: 400,
    suv: 500,
    premium_hatch: 400,
    premium_sedan_suv: 500,
    muv: 550
  },
  'Water Wash': {
    hatchback: 200,
    sedan_compact_suv: 250,
    sedan: 250,
    mini_suv: 250,
    suv: 350,
    premium_hatch: 250,
    premium_sedan_suv: 350,
    muv: 400
  },
  'Interior & Vacuum': {
    hatchback: 350,
    sedan_compact_suv: 400,
    sedan: 400,
    mini_suv: 400,
    suv: 500,
    premium_hatch: 400,
    premium_sedan_suv: 500,
    muv: 550
  },
  'Bike / Scooter Wash': {
    bike: 250,
    scooter: 250
  },
  'Chain Lube': {
    bike: 150
  }
};

const insertOrGetWt = db.prepare('INSERT OR IGNORE INTO wash_types (name) VALUES (?)');
const getWt = db.prepare('SELECT * FROM wash_types WHERE name = ?');
const upsertPricing = db.prepare('INSERT OR REPLACE INTO pricing (wash_type_id, segment, price) VALUES (?, ?, ?)');
const deletePricing = db.prepare('DELETE FROM pricing WHERE wash_type_id = ? AND segment = ?');
const deleteWp = db.prepare('DELETE FROM workshop_pricing WHERE wash_type_id = ? AND segment = ?');

// Clean up old bike/scooter pricing from car wash types and scooter pricing from Chain Lube
const carWashTypeNames = ['Full Body Wash', 'Body Wash', 'Water Wash', 'Interior & Vacuum'];
for (const wtName of carWashTypeNames) {
  const wtObj = getWt.get(wtName);
  if (wtObj) {
    for (const bSeg of bikeSegments) {
      deletePricing.run(wtObj.id, bSeg);
      deleteWp.run(wtObj.id, bSeg);
    }
  }
}

const chainLubeWt = getWt.get('Chain Lube');
if (chainLubeWt) {
  deletePricing.run(chainLubeWt.id, 'scooter');
  deleteWp.run(chainLubeWt.id, 'scooter');
}

for (const wtName of defaultWashTypes) {
  insertOrGetWt.run(wtName);
  const wtObj = getWt.get(wtName);
  if (wtObj) {
    const pricesForType = normalPricesMap[wtName] || {};
    for (const seg of Object.keys(pricesForType)) {
      upsertPricing.run(wtObj.id, seg, pricesForType[seg]);
    }
  }
}

// Seed default workshop pricing if empty or missing entries
const insertDefaultWp = db.prepare('INSERT OR IGNORE INTO workshop_pricing (workshop_id, wash_type_id, segment, price) VALUES (NULL, ?, ?, ?)');
const allPricing = db.prepare('SELECT * FROM pricing').all();
for (const p of allPricing) {
  insertDefaultWp.run(p.wash_type_id, p.segment, p.price);
}

module.exports = db;

