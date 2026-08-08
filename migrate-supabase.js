require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in backend/.env!");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log("Connecting to Supabase PostgreSQL...");
  const client = await pool.connect();
  
  try {
    console.log("Initializing database schema on Supabase...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        branch_id INT NOT NULL DEFAULT 1,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        role VARCHAR(50) NOT NULL DEFAULT 'washer',
        daily_wage NUMERIC NOT NULL DEFAULT 0,
        monthly_salary NUMERIC NOT NULL DEFAULT 0,
        joined_date VARCHAR(50),
        aadhaar_number VARCHAR(50),
        aadhaar_file TEXT
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL,
        date VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        note TEXT,
        UNIQUE(employee_id, date)
      );

      CREATE TABLE IF NOT EXISTS advances (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL,
        date VARCHAR(50) NOT NULL,
        amount NUMERIC NOT NULL,
        note TEXT,
        payment_method VARCHAR(50) DEFAULT 'cash'
      );

      CREATE TABLE IF NOT EXISTS payroll (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL,
        month INT NOT NULL,
        year INT NOT NULL,
        days_present NUMERIC NOT NULL,
        daily_wage NUMERIC NOT NULL,
        gross_pay NUMERIC NOT NULL,
        total_advances NUMERIC NOT NULL,
        net_pay NUMERIC NOT NULL,
        paid_date VARCHAR(50),
        UNIQUE(employee_id, month, year)
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) UNIQUE,
        name VARCHAR(255),
        reward_points INT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        reg_number VARCHAR(50) UNIQUE NOT NULL,
        brand VARCHAR(255),
        model VARCHAR(255),
        segment VARCHAR(100),
        color VARCHAR(100),
        customer_id INT
      );

      CREATE TABLE IF NOT EXISTS wash_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pricing (
        id SERIAL PRIMARY KEY,
        wash_type_id INT NOT NULL,
        segment VARCHAR(100) NOT NULL,
        price NUMERIC NOT NULL,
        UNIQUE(wash_type_id, segment)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        branch_id INT NOT NULL DEFAULT 1,
        vehicle_id INT NOT NULL,
        wash_type_id INT NOT NULL,
        entry_time VARCHAR(100) NOT NULL,
        exit_time VARCHAR(100),
        eta_minutes INT DEFAULT 30,
        status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
        has_chain_lube INT DEFAULT 0,
        chain_lube_price NUMERIC DEFAULT 0,
        customer_type VARCHAR(50) DEFAULT 'normal',
        workshop_id INT,
        payment_status VARCHAR(50) DEFAULT 'unsettled'
      );

      CREATE TABLE IF NOT EXISTS bills (
        id SERIAL PRIMARY KEY,
        job_id INT UNIQUE NOT NULL,
        amount NUMERIC NOT NULL,
        discount_amount NUMERIC NOT NULL DEFAULT 0,
        final_amount NUMERIC NOT NULL,
        payment_method VARCHAR(50),
        reward_points_earned INT NOT NULL DEFAULT 0,
        reward_points_redeemed INT NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
        paid_at VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        branch_id INT NOT NULL DEFAULT 1,
        category VARCHAR(100) NOT NULL,
        amount NUMERIC NOT NULL,
        note TEXT,
        date VARCHAR(50) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'gpay'
      );

      CREATE TABLE IF NOT EXISTS daily_opening_balances (
        date VARCHAR(50) PRIMARY KEY,
        opening_cash NUMERIC NOT NULL DEFAULT 0,
        opening_gpay NUMERIC NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS workshops (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        owner_name VARCHAR(255),
        owner_phone VARCHAR(50),
        type VARCHAR(100) NOT NULL DEFAULT 'Car Workshop',
        created_at VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workshop_pricing (
        id SERIAL PRIMARY KEY,
        workshop_id INT,
        wash_type_id INT NOT NULL,
        segment VARCHAR(100) NOT NULL,
        price NUMERIC NOT NULL
      );
    `);

    console.log("Schema created successfully!");

    // Seed default branch if empty
    const branchRes = await client.query('SELECT COUNT(*) FROM branches');
    if (parseInt(branchRes.rows[0].count) === 0) {
      await client.query("INSERT INTO branches (name) VALUES ('Main Branch')");
    }

    // Seed wash types
    const defaultWashTypes = ['Full Body Wash', 'Body Wash', 'Water Wash', 'Interior & Vacuum', 'Bike / Scooter Wash', 'Chain Lube'];
    const normalPricesMap = {
      'Full Body Wash': { hatchback: 500, sedan_compact_suv: 550, sedan: 550, mini_suv: 550, suv: 650, premium_hatch: 600, premium_sedan_suv: 650, muv: 700 },
      'Body Wash': { hatchback: 350, sedan_compact_suv: 400, sedan: 400, mini_suv: 400, suv: 500, premium_hatch: 400, premium_sedan_suv: 500, muv: 550 },
      'Water Wash': { hatchback: 200, sedan_compact_suv: 250, sedan: 250, mini_suv: 250, suv: 350, premium_hatch: 250, premium_sedan_suv: 350, muv: 400 },
      'Interior & Vacuum': { hatchback: 350, sedan_compact_suv: 400, sedan: 400, mini_suv: 400, suv: 500, premium_hatch: 400, premium_sedan_suv: 500, muv: 550 },
      'Bike / Scooter Wash': { bike: 250, scooter: 250 },
      'Chain Lube': { bike: 150 }
    };

    for (const wtName of defaultWashTypes) {
      await client.query("INSERT INTO wash_types (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [wtName]);
      const wtRes = await client.query("SELECT id FROM wash_types WHERE name = $1", [wtName]);
      if (wtRes.rows.length > 0) {
        const wtId = wtRes.rows[0].id;
        const prices = normalPricesMap[wtName] || {};
        for (const seg of Object.keys(prices)) {
          await client.query(
            "INSERT INTO pricing (wash_type_id, segment, price) VALUES ($1, $2, $3) ON CONFLICT (wash_type_id, segment) DO UPDATE SET price = EXCLUDED.price",
            [wtId, seg, prices[seg]]
          );
        }
      }
    }

    console.log("Supabase database tables & pricing seeded successfully!");
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
