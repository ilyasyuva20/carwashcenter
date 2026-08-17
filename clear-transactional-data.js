require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const tablesToClear = [
  'jobs',
  'bills',
  'vehicles',
  'customers',
  'attendance',
  'advances',
  'payroll',
  'expenses',
  'daily_opening_balances'
];

async function clearData() {
  console.log("🧹 Clearing transactional data while keeping master data (employees, pricing, wash_types, workshops)...");

  // 1. Clear PostgreSQL if DATABASE_URL is set
  if (process.env.DATABASE_URL) {
    console.log("⚡ Cleaning Supabase Cloud PostgreSQL...");
    const pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const truncateList = tablesToClear.join(', ');
      console.log(`Truncating tables: ${truncateList}`);
      await client.query(`TRUNCATE ${truncateList} RESTART IDENTITY CASCADE;`);
      await client.query('COMMIT');
      console.log("✅ Supabase Cloud PostgreSQL transaction tables cleared!");
    } catch (err) {
      await client.query('ROLLBACK');
      console.error("❌ Postgres clear error:", err.message);
    } finally {
      client.release();
      await pgPool.end();
    }
  }

  // 2. Clear Local SQLite database
  try {
    console.log("📁 Cleaning Local SQLite (carwash.db)...");
    const sqliteDb = new Database(path.join(__dirname, 'carwash.db'));
    sqliteDb.exec('BEGIN TRANSACTION;');
    for (const table of tablesToClear) {
      sqliteDb.exec(`DELETE FROM ${table};`);
      sqliteDb.exec(`DELETE FROM sqlite_sequence WHERE name='${table}';`);
    }
    sqliteDb.exec('COMMIT;');
    console.log("✅ Local SQLite database transaction tables cleared!");
  } catch (err) {
    console.error("❌ SQLite clear error:", err.message);
  }

  console.log("\n🎉 Database clean-up completed successfully!");
}

clearData();
