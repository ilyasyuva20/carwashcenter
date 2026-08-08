require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in .env!");
  process.exit(1);
}

const sqliteDb = new Database(path.join(__dirname, 'carwash.db'));
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function batchInsert(client, table, columns, rows) {
  if (!rows || rows.length === 0) return;
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuePlaceholders = [];
    const params = [];
    let paramIndex = 1;

    for (const row of chunk) {
      const rowPlaceholders = [];
      for (const col of columns) {
        rowPlaceholders.push(`$${paramIndex++}`);
        params.push(row[col]);
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuePlaceholders.join(', ')}`;
    await client.query(query, params);
  }
}

async function migrateAllMasterData() {
  console.log("⚡ Starting fast batch master data migration from carwash.db to Supabase PostgreSQL...");
  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    console.log("Truncating existing tables for clean sync...");
    await client.query(`
      TRUNCATE bills, jobs, attendance, advances, payroll, expenses,
               workshop_pricing, pricing, wash_types, workshops,
               vehicles, customers, employees, branches, daily_opening_balances
      RESTART IDENTITY CASCADE;
    `);

    // 1. Branches
    const branches = sqliteDb.prepare('SELECT * FROM branches').all();
    console.log(`Migrating ${branches.length} branches...`);
    await batchInsert(client, 'branches', ['id', 'name'], branches);

    // 2. Wash Types
    const washTypes = sqliteDb.prepare('SELECT * FROM wash_types').all();
    console.log(`Migrating ${washTypes.length} wash_types...`);
    await batchInsert(client, 'wash_types', ['id', 'name'], washTypes);

    // 3. Pricing
    const pricing = sqliteDb.prepare('SELECT * FROM pricing').all();
    console.log(`Migrating ${pricing.length} pricing rules...`);
    await batchInsert(client, 'pricing', ['id', 'wash_type_id', 'segment', 'price'], pricing);

    // 4. Workshops
    const workshops = sqliteDb.prepare('SELECT * FROM workshops').all().map(w => ({
      id: w.id,
      name: w.name,
      address: w.address || null,
      phone: w.phone || null,
      owner_name: w.owner_name || null,
      owner_phone: w.owner_phone || null,
      type: w.type || 'Car Workshop',
      created_at: w.created_at || new Date().toISOString()
    }));
    console.log(`Migrating ${workshops.length} workshops...`);
    await batchInsert(client, 'workshops', ['id', 'name', 'address', 'phone', 'owner_name', 'owner_phone', 'type', 'created_at'], workshops);

    // 5. Workshop Pricing
    const workshopPricing = sqliteDb.prepare('SELECT * FROM workshop_pricing').all().map(wp => ({
      id: wp.id,
      workshop_id: wp.workshop_id || null,
      wash_type_id: wp.wash_type_id,
      segment: wp.segment,
      price: wp.price
    }));
    console.log(`Migrating ${workshopPricing.length} workshop pricing entries...`);
    await batchInsert(client, 'workshop_pricing', ['id', 'workshop_id', 'wash_type_id', 'segment', 'price'], workshopPricing);

    // 6. Employees
    const employees = sqliteDb.prepare('SELECT * FROM employees').all().map(e => {
      const salaryMonthly = e.salary_monthly || e.monthly_salary || 0;
      const joinDate = e.join_date || e.joined_date || null;
      return {
        id: e.id,
        branch_id: e.branch_id || 1,
        name: e.name,
        phone: e.phone || null,
        role: e.role || 'washer',
        daily_wage: e.daily_wage || 0,
        monthly_salary: salaryMonthly,
        salary_monthly: salaryMonthly,
        joined_date: joinDate,
        join_date: joinDate,
        aadhaar_number: e.aadhaar_number || null,
        aadhaar_file: e.aadhaar_file || null,
        active: e.active !== undefined ? e.active : 1
      };
    });
    console.log(`Migrating ${employees.length} employees...`);
    await batchInsert(client, 'employees', ['id', 'branch_id', 'name', 'phone', 'role', 'daily_wage', 'monthly_salary', 'salary_monthly', 'joined_date', 'join_date', 'aadhaar_number', 'aadhaar_file', 'active'], employees);

    // 7. Customers
    const customers = sqliteDb.prepare('SELECT * FROM customers').all().map(c => ({
      id: c.id,
      phone: c.phone || null,
      name: c.name || null,
      reward_points: c.reward_points || 0
    }));
    console.log(`Migrating ${customers.length} customers...`);
    await batchInsert(client, 'customers', ['id', 'phone', 'name', 'reward_points'], customers);

    // 8. Vehicles
    const vehicles = sqliteDb.prepare('SELECT * FROM vehicles').all().map(v => ({
      id: v.id,
      reg_number: v.reg_number,
      brand: v.brand || '',
      model: v.model || '',
      segment: v.segment || 'hatchback',
      color: v.color || '',
      customer_id: v.customer_id || null
    }));
    console.log(`Migrating ${vehicles.length} vehicles...`);
    await batchInsert(client, 'vehicles', ['id', 'reg_number', 'brand', 'model', 'segment', 'color', 'customer_id'], vehicles);

    // 9. Jobs
    const jobs = sqliteDb.prepare('SELECT * FROM jobs').all().map(j => ({
      id: j.id,
      branch_id: j.branch_id || 1,
      vehicle_id: j.vehicle_id,
      wash_type_id: j.wash_type_id,
      entry_time: j.entry_time,
      exit_time: j.exit_time || null,
      eta_minutes: j.eta_minutes || 30,
      status: j.status || 'in_progress',
      has_chain_lube: j.has_chain_lube || 0,
      chain_lube_price: j.chain_lube_price || 0,
      customer_type: j.customer_type || 'normal',
      workshop_id: j.workshop_id || null,
      payment_status: j.payment_status || 'unsettled'
    }));
    console.log(`Migrating ${jobs.length} jobs...`);
    await batchInsert(client, 'jobs', ['id', 'branch_id', 'vehicle_id', 'wash_type_id', 'entry_time', 'exit_time', 'eta_minutes', 'status', 'has_chain_lube', 'chain_lube_price', 'customer_type', 'workshop_id', 'payment_status'], jobs);

    // 10. Bills
    const bills = sqliteDb.prepare('SELECT * FROM bills').all().map(b => ({
      id: b.id,
      job_id: b.job_id,
      amount: b.amount,
      discount_amount: b.discount_amount || 0,
      final_amount: b.final_amount,
      payment_method: b.payment_method || 'cash',
      reward_points_earned: b.reward_points_earned || 0,
      reward_points_redeemed: b.reward_points_redeemed || 0,
      status: b.status || 'paid',
      paid_at: b.paid_at || null
    }));
    console.log(`Migrating ${bills.length} bills...`);
    await batchInsert(client, 'bills', ['id', 'job_id', 'amount', 'discount_amount', 'final_amount', 'payment_method', 'reward_points_earned', 'reward_points_redeemed', 'status', 'paid_at'], bills);

    // 11. Advances
    const advances = sqliteDb.prepare('SELECT * FROM advances').all().map(a => ({
      id: a.id,
      employee_id: a.employee_id,
      date: a.date,
      amount: a.amount,
      note: a.note || null,
      payment_method: a.payment_method || 'cash'
    }));
    console.log(`Migrating ${advances.length} advances...`);
    await batchInsert(client, 'advances', ['id', 'employee_id', 'date', 'amount', 'note', 'payment_method'], advances);

    // 12. Attendance
    const attendance = sqliteDb.prepare('SELECT * FROM attendance').all().map(att => ({
      id: att.id,
      employee_id: att.employee_id,
      date: att.date,
      status: att.status,
      check_in: att.check_in || null,
      check_out: att.check_out || null,
      late_minutes: att.late_minutes || 0,
      overtime_minutes: att.overtime_minutes || 0,
      note: att.note || null
    }));
    console.log(`Migrating ${attendance.length} attendance records...`);
    await batchInsert(client, 'attendance', ['id', 'employee_id', 'date', 'status', 'check_in', 'check_out', 'late_minutes', 'overtime_minutes', 'note'], attendance);

    // 13. Expenses
    const expenses = sqliteDb.prepare('SELECT * FROM expenses').all().map(exp => ({
      id: exp.id,
      branch_id: exp.branch_id || 1,
      category: exp.category,
      amount: exp.amount,
      note: exp.note || null,
      date: exp.date,
      payment_method: exp.payment_method || 'gpay'
    }));
    console.log(`Migrating ${expenses.length} expenses...`);
    await batchInsert(client, 'expenses', ['id', 'branch_id', 'category', 'amount', 'note', 'date', 'payment_method'], expenses);

    // 14. Reset SERIAL sequences so future auto-increment IDs work correctly
    const sequenceTables = ['branches', 'wash_types', 'pricing', 'workshops', 'workshop_pricing', 'employees', 'customers', 'vehicles', 'jobs', 'bills', 'advances', 'attendance', 'expenses'];
    for (const table of sequenceTables) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1)) FROM ${table};`);
    }

    await client.query('COMMIT');
    console.log("🎉 ALL MASTER DATA MIGRATED TO SUPABASE CLOUD POSTGRESQL SUCCESSFULLY!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pgPool.end();
  }
}

migrateAllMasterData();
