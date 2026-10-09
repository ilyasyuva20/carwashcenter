require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const Database = require('better-sqlite3');

function getSqliteDb() {
  const sqlite = new Database(path.join(__dirname, 'carwash.db'));
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'washer', daily_wage REAL NOT NULL DEFAULT 0, monthly_salary REAL NOT NULL DEFAULT 0, salary_monthly REAL NOT NULL DEFAULT 0, joined_date TEXT, join_date TEXT, aadhaar_number TEXT, aadhaar_file TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, check_in TEXT, check_out TEXT, late_minutes INTEGER DEFAULT 0, overtime_minutes INTEGER DEFAULT 0, note TEXT, shift_start TEXT DEFAULT '08:00', UNIQUE(employee_id, date));
    CREATE TABLE IF NOT EXISTS advances (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, note TEXT, payment_method TEXT DEFAULT 'cash');
    CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, base_salary REAL DEFAULT 0, present_days REAL DEFAULT 0, leave_days REAL DEFAULT 0, late_deduction REAL DEFAULT 0, overtime_pay REAL DEFAULT 0, advance_deduction REAL DEFAULT 0, net_pay REAL NOT NULL, paid_date TEXT, generated_at TEXT, UNIQUE(employee_id, month, year));
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, name TEXT, reward_points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, reg_number TEXT UNIQUE NOT NULL, brand TEXT, model TEXT, segment TEXT, color TEXT, year TEXT, customer_id INTEGER);
    CREATE TABLE IF NOT EXISTS wash_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS pricing (id INTEGER PRIMARY KEY AUTOINCREMENT, wash_type_id INTEGER NOT NULL, segment TEXT NOT NULL, price REAL NOT NULL, UNIQUE(wash_type_id, segment));
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, vehicle_id INTEGER NOT NULL, wash_type_id INTEGER NOT NULL, entry_time TEXT NOT NULL, exit_time TEXT, eta_minutes INTEGER DEFAULT 30, status TEXT NOT NULL DEFAULT 'in_progress', has_chain_lube INTEGER DEFAULT 0, chain_lube_price REAL DEFAULT 0, customer_type TEXT DEFAULT 'normal', workshop_id INTEGER, payment_status TEXT DEFAULT 'unsettled', customer_name TEXT, before_photos TEXT, offer_price REAL, paid_amount REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER UNIQUE NOT NULL, amount REAL NOT NULL, discount_amount REAL NOT NULL DEFAULT 0, final_amount REAL NOT NULL, payment_method TEXT, reward_points_earned INTEGER NOT NULL DEFAULT 0, reward_points_redeemed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unpaid', paid_at TEXT);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, category TEXT NOT NULL, amount REAL NOT NULL, note TEXT, date TEXT NOT NULL, payment_method TEXT DEFAULT 'gpay');
    CREATE TABLE IF NOT EXISTS daily_opening_balances (date TEXT PRIMARY KEY, opening_cash REAL NOT NULL DEFAULT 0, opening_gpay REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS workshops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, phone TEXT, owner_name TEXT, owner_phone TEXT, type TEXT NOT NULL DEFAULT 'Car Workshop', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workshop_pricing (id INTEGER PRIMARY KEY AUTOINCREMENT, workshop_id INTEGER, wash_type_id INTEGER NOT NULL, segment TEXT NOT NULL, price REAL NOT NULL, UNIQUE(workshop_id, wash_type_id, segment));
    CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company_name TEXT, category TEXT NOT NULL DEFAULT 'Other', gst TEXT, location TEXT, contact_number TEXT, sales_person_name TEXT, sales_person_number TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS supplier_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, item_details TEXT, category TEXT, total_amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, pending_amount REAL NOT NULL DEFAULT 0, payment_method TEXT DEFAULT 'cash', date TEXT NOT NULL, note TEXT, expense_id INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS supplier_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, purchase_id INTEGER, amount REAL NOT NULL DEFAULT 0, payment_method TEXT DEFAULT 'cash', date TEXT NOT NULL, note TEXT, expense_id INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, plan_name TEXT NOT NULL DEFAULT 'Monthly Wash Package', price REAL NOT NULL DEFAULT 0, start_date TEXT NOT NULL, end_date TEXT NOT NULL, max_washes INTEGER DEFAULT -1, washes_used INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', payment_method TEXT DEFAULT 'cash', notes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscription_vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER NOT NULL, vehicle_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscription_washes (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER NOT NULL, job_id INTEGER, vehicle_id INTEGER, wash_date TEXT NOT NULL);
  `);

  try { sqlite.exec('ALTER TABLE jobs ADD COLUMN customer_name TEXT'); } catch(e){}
  try { sqlite.exec('ALTER TABLE jobs ADD COLUMN before_photos TEXT'); } catch(e){}
  try { sqlite.exec('ALTER TABLE jobs ADD COLUMN offer_price REAL'); } catch(e){}
  try { sqlite.exec('ALTER TABLE jobs ADD COLUMN paid_amount REAL DEFAULT 0'); } catch(e){}
  try { sqlite.exec('ALTER TABLE customers ADD COLUMN name TEXT'); } catch(e){}
  try { sqlite.exec('ALTER TABLE vehicles ADD COLUMN year TEXT'); } catch(e){}
  try { sqlite.exec('ALTER TABLE vehicles ADD COLUMN owner_name TEXT'); } catch(e){}
  try { sqlite.exec('ALTER TABLE bills ADD COLUMN cash_amount REAL DEFAULT 0'); } catch(e){}
  try { sqlite.exec('ALTER TABLE bills ADD COLUMN gpay_amount REAL DEFAULT 0'); } catch(e){}
  try { sqlite.exec("ALTER TABLE attendance ADD COLUMN shift_start TEXT DEFAULT '08:00'"); } catch(e){}
  try { sqlite.exec("ALTER TABLE employees ADD COLUMN default_shift TEXT DEFAULT '08:00'"); } catch(e){}
  try { sqlite.exec("ALTER TABLE supplier_purchases ADD COLUMN bill_url TEXT"); } catch(e){}

  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_jobs_customer_status ON jobs(customer_type, status, payment_status);
      CREATE INDEX IF NOT EXISTS idx_jobs_vehicle_id ON jobs(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_workshop_id ON jobs(workshop_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_entry_time ON jobs(entry_time);
      CREATE INDEX IF NOT EXISTS idx_jobs_exit_time ON jobs(exit_time);
      CREATE INDEX IF NOT EXISTS idx_bills_job_id ON bills(job_id);
      CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
      CREATE INDEX IF NOT EXISTS idx_vehicles_reg ON vehicles(reg_number);
      CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    `);
  } catch (e) {}

  return sqlite;
}

let sqliteDbInstance = null;
function getSqlite() {
  if (!sqliteDbInstance) sqliteDbInstance = getSqliteDb();
  return sqliteDbInstance;
}

function convertSql(sql) {
  let paramCount = 0;
  return sql.replace(/\?/g, () => `$${++paramCount}`);
}

const usePostgres = !!process.env.DATABASE_URL;
let pool = null;

if (usePostgres) {
  console.log("⚡ [DB] Configured for Supabase Cloud PostgreSQL...");
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000
  });

  pool.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_name TEXT;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS before_photos TEXT;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS offer_price REAL;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_amount REAL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year TEXT;
    ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_name TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_start TEXT DEFAULT '08:00';
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_shift TEXT DEFAULT '08:00';
    ALTER TABLE supplier_purchases ADD COLUMN IF NOT EXISTS bill_url TEXT;
  `).catch(err => console.warn("⚡ [DB] Postgres pool query warning:", err.message));
}

const db = {
  isPostgres: usePostgres,
  prepare(sql) {
    const pgSql = convertSql(sql);
    return {
      async get(...args) {
        const cleanArgs = args.flat().map(arg => (arg === undefined || arg === 'null' || arg === 'undefined' || (typeof arg === 'number' && isNaN(arg))) ? null : arg);
        if (pool) {
          try {
            const res = await pool.query(pgSql, cleanArgs);
            return res.rows[0] || null;
          } catch (err) {
            console.warn(`⚡ [DB] Postgres query error (${err.message}). Falling back to local SQLite...`);
          }
        }
        return getSqlite().prepare(sql).get(...cleanArgs);
      },
      async all(...args) {
        const cleanArgs = args.flat().map(arg => (arg === undefined || arg === 'null' || arg === 'undefined' || (typeof arg === 'number' && isNaN(arg))) ? null : arg);
        if (pool) {
          try {
            const res = await pool.query(pgSql, cleanArgs);
            return res.rows;
          } catch (err) {
            console.warn(`⚡ [DB] Postgres query error (${err.message}). Falling back to local SQLite...`);
          }
        }
        return getSqlite().prepare(sql).all(...cleanArgs);
      },
      async run(...args) {
        const cleanArgs = args.flat().map(arg => (arg === undefined || arg === 'null' || arg === 'undefined' || (typeof arg === 'number' && isNaN(arg))) ? null : arg);
        if (pool) {
          try {
            let query = pgSql;
            const isInsert = /^\s*INSERT\s+INTO/i.test(query);
            if (isInsert && !/RETURNING/i.test(query)) {
              query += ' RETURNING *';
            }
            const res = await pool.query(query, cleanArgs);
            const lastInsertRowid = (res.rows[0] && res.rows[0].id) ? res.rows[0].id : null;
            return { lastInsertRowid, changes: res.rowCount };
          } catch (err) {
            if (err.code === '23505') return { lastInsertRowid: null, changes: 0 };
            console.warn(`⚡ [DB] Postgres query error (${err.message}). Falling back to local SQLite...`);
          }
        }
        const stmt = getSqlite().prepare(sql);
        const info = stmt.run(...cleanArgs);
        return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
      }
    };
  },
  async exec(sql) {
    if (pool) {
      try {
        return await pool.query(sql);
      } catch (err) {
        console.warn(`⚡ [DB] Postgres exec error (${err.message}). Falling back to local SQLite...`);
      }
    }
    return getSqlite().exec(sql);
  }
};

module.exports = db;
