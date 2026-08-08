require('dotenv').config();
const path = require('path');

const usePostgres = !!process.env.DATABASE_URL;

if (usePostgres) {
  console.log("⚡ [DB] Connecting to Supabase Cloud PostgreSQL...");
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  function convertSql(sql) {
    let paramCount = 0;
    return sql.replace(/\?/g, () => `$${++paramCount}`);
  }

  const db = {
    isPostgres: true,
    pool,
    prepare(sql) {
      const pgSql = convertSql(sql);
      return {
        async get(...args) {
          const res = await pool.query(pgSql, args.flat());
          return res.rows[0] || null;
        },
        async all(...args) {
          const res = await pool.query(pgSql, args.flat());
          return res.rows;
        },
        async run(...args) {
          let query = pgSql;
          const isInsert = /^\s*INSERT\s+INTO/i.test(query);
          if (isInsert && !/RETURNING/i.test(query)) {
            query += ' RETURNING id';
          }
          try {
            const res = await pool.query(query, args.flat());
            const lastInsertRowid = (res.rows[0] && res.rows[0].id) ? res.rows[0].id : null;
            return { lastInsertRowid, changes: res.rowCount };
          } catch (err) {
            // Ignore duplicate key errors for ON CONFLICT equivalents if needed
            if (err.code === '23505') return { lastInsertRowid: null, changes: 0 };
            throw err;
          }
        }
      };
    },
    async exec(sql) {
      return pool.query(sql);
    }
  };

  module.exports = db;

} else {
  console.log("📁 [DB] Connecting to Local SQLite Database (carwash.db)...");
  const Database = require('better-sqlite3');
  const db = new Database(path.join(__dirname, 'carwash.db'));

  // Ensure tables exist for local SQLite fallback
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, phone TEXT, role TEXT NOT NULL DEFAULT 'washer', daily_wage REAL NOT NULL DEFAULT 0, monthly_salary REAL NOT NULL DEFAULT 0, salary_monthly REAL NOT NULL DEFAULT 0, joined_date TEXT, join_date TEXT, aadhaar_number TEXT, aadhaar_file TEXT, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, check_in TEXT, check_out TEXT, late_minutes INTEGER DEFAULT 0, overtime_minutes INTEGER DEFAULT 0, note TEXT, UNIQUE(employee_id, date));
    CREATE TABLE IF NOT EXISTS advances (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, note TEXT, payment_method TEXT DEFAULT 'cash');
    CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, base_salary REAL DEFAULT 0, present_days REAL DEFAULT 0, leave_days REAL DEFAULT 0, late_deduction REAL DEFAULT 0, overtime_pay REAL DEFAULT 0, advance_deduction REAL DEFAULT 0, net_pay REAL NOT NULL, paid_date TEXT, generated_at TEXT, UNIQUE(employee_id, month, year));
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, name TEXT, reward_points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, reg_number TEXT UNIQUE NOT NULL, brand TEXT, model TEXT, segment TEXT, color TEXT, customer_id INTEGER);
    CREATE TABLE IF NOT EXISTS wash_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS pricing (id INTEGER PRIMARY KEY AUTOINCREMENT, wash_type_id INTEGER NOT NULL, segment TEXT NOT NULL, price REAL NOT NULL, UNIQUE(wash_type_id, segment));
    CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, vehicle_id INTEGER NOT NULL, wash_type_id INTEGER NOT NULL, entry_time TEXT NOT NULL, exit_time TEXT, eta_minutes INTEGER DEFAULT 30, status TEXT NOT NULL DEFAULT 'in_progress', has_chain_lube INTEGER DEFAULT 0, chain_lube_price REAL DEFAULT 0, customer_type TEXT DEFAULT 'normal', workshop_id INTEGER, payment_status TEXT DEFAULT 'unsettled');
    CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER UNIQUE NOT NULL, amount REAL NOT NULL, discount_amount REAL NOT NULL DEFAULT 0, final_amount REAL NOT NULL, payment_method TEXT, reward_points_earned INTEGER NOT NULL DEFAULT 0, reward_points_redeemed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unpaid', paid_at TEXT);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER NOT NULL DEFAULT 1, category TEXT NOT NULL, amount REAL NOT NULL, note TEXT, date TEXT NOT NULL, payment_method TEXT DEFAULT 'gpay');
    CREATE TABLE IF NOT EXISTS daily_opening_balances (date TEXT PRIMARY KEY, opening_cash REAL NOT NULL DEFAULT 0, opening_gpay REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS workshops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, phone TEXT, owner_name TEXT, owner_phone TEXT, type TEXT NOT NULL DEFAULT 'Car Workshop', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workshop_pricing (id INTEGER PRIMARY KEY AUTOINCREMENT, workshop_id INTEGER, wash_type_id INTEGER NOT NULL, segment TEXT NOT NULL, price REAL NOT NULL, UNIQUE(workshop_id, wash_type_id, segment));
  `);

  module.exports = db;
}
