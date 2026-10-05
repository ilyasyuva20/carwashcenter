const express = require('express');
const router = express.Router();
const db = require('../db');

async function summaryFor(date) {
  const bills = await db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at LIKE ?`).all(`${date}%`);
  const cash = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + Number(b.final_amount), 0);
  const gpay = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + Number(b.final_amount), 0);
  const revenue = cash + gpay;
  
  const jobsTodayRow = await db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE entry_time LIKE ?`).get(`${date}%`);
  const jobsToday = jobsTodayRow ? Number(jobsTodayRow.c) : 0;

  const expensesRow = await db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM expenses WHERE date = ?`).get(date);
  const expenses = expensesRow ? Number(expensesRow.s) : 0;

  const unpaidBillsRow = await db.prepare(`SELECT COUNT(*) as c FROM bills WHERE status='unpaid'`).get();
  const unpaidBills = unpaidBillsRow ? Number(unpaidBillsRow.c) : 0;

  return { date, vehicles: jobsToday, cash_payment: cash, gpay_payment: gpay, revenue, expenses, unpaid_bills: unpaidBills, bills_count: bills.length };
}

async function ledgerFor(date) {
  const op = (await db.prepare('SELECT opening_cash, opening_gpay FROM daily_opening_balances WHERE date = ?').get(date)) || { opening_cash: 0, opening_gpay: 0 };
  
  const bills = await db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at LIKE ?`).all(`${date}%`);
  const cashSales = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + Number(b.final_amount), 0);
  const gpaySales = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + Number(b.final_amount), 0);
  const totalSales = cashSales + gpaySales;

  const expenses = await db.prepare(`SELECT * FROM expenses WHERE date = ? ORDER BY id DESC`).all(date);
  const cashExpenses = expenses.filter(e => e.payment_method === 'cash').reduce((s, e) => s + Number(e.amount), 0);
  const gpayExpenses = expenses.filter(e => e.payment_method !== 'cash').reduce((s, e) => s + Number(e.amount), 0);
  const totalExpenses = cashExpenses + gpayExpenses;

  const advances = await db.prepare(`SELECT * FROM advances WHERE date LIKE ?`).all(`${date}%`);
  const cashAdvances = advances.filter(a => a.payment_method === 'cash').reduce((s, a) => s + Number(a.amount), 0);
  const gpayAdvances = advances.filter(a => a.payment_method === 'gpay').reduce((s, a) => s + Number(a.amount), 0);
  const totalAdvances = cashAdvances + gpayAdvances;

  const openingCash = Number(op.opening_cash) || 0;
  const openingGpay = Number(op.opening_gpay) || 0;

  const closingCash = openingCash + cashSales - cashExpenses - cashAdvances;
  const closingGpay = openingGpay + gpaySales - gpayExpenses - gpayAdvances;

  return {
    date,
    opening_cash: openingCash,
    opening_gpay: openingGpay,
    cash_sales: cashSales,
    gpay_sales: gpaySales,
    total_sales: totalSales,
    cash_expenses: cashExpenses,
    gpay_expenses: gpayExpenses,
    total_expenses: totalExpenses,
    cash_advances: cashAdvances,
    gpay_advances: gpayAdvances,
    total_advances: totalAdvances,
    closing_cash: closingCash,
    closing_gpay: closingGpay,
    expenses_list: expenses,
    bills_count: bills.length
  };
}

router.get('/today', async (req, res) => {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const summary = await summaryFor(date);
    const ledger = await ledgerFor(date);
    res.json({ ...summary, ledger });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ledger', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const ledger = await ledgerFor(targetDate);
    res.json(ledger);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/opening-balance', async (req, res) => {
  try {
    const { date, opening_cash, opening_gpay } = req.body;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const opCash = Number(opening_cash) || 0;
    const opGpay = Number(opening_gpay) || 0;

    if (db.isPostgres) {
      await db.prepare(`
        INSERT INTO daily_opening_balances (date, opening_cash, opening_gpay)
        VALUES (?, ?, ?)
        ON CONFLICT (date) DO UPDATE SET opening_cash = EXCLUDED.opening_cash, opening_gpay = EXCLUDED.opening_gpay
      `).run(targetDate, opCash, opGpay);
    } else {
      const existing = await db.prepare('SELECT * FROM daily_opening_balances WHERE date = ?').get(targetDate);
      if (existing) {
        await db.prepare('UPDATE daily_opening_balances SET opening_cash = ?, opening_gpay = ? WHERE date = ?')
          .run(opCash, opGpay, targetDate);
      } else {
        await db.prepare('INSERT INTO daily_opening_balances (date, opening_cash, opening_gpay) VALUES (?, ?, ?)')
          .run(targetDate, opCash, opGpay);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error in POST /reports/opening-balance:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily', async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await summaryFor(date || new Date().toISOString().slice(0, 10));
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/range', async (req, res) => {
  try {
    const { from, to } = req.query;
    const allBills = await db.prepare(`SELECT * FROM bills WHERE status='paid'`).all();
    const bills = allBills.filter(b => {
      const d = (b.paid_at || b.created_at || '').slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    });

    const cash = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + Number(b.final_amount), 0);
    const gpay = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + Number(b.final_amount), 0);
    const revenue = cash + gpay;

    const allExpenses = await db.prepare(`SELECT * FROM expenses`).all();
    const expensesList = allExpenses.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
    const expenses = expensesList.reduce((s, e) => s + Number(e.amount), 0);

    const topWash = await db.prepare(`
      SELECT wt.name, COUNT(*) as c, SUM(b.final_amount) as revenue
      FROM bills b JOIN jobs j ON j.id = b.job_id JOIN wash_types wt ON wt.id = j.wash_type_id
      WHERE b.status='paid'
      GROUP BY wt.name ORDER BY c DESC
    `).all();

    res.json({ from, to, vehicles: bills.length, cash_payment: cash, gpay_payment: gpay, revenue, expenses, net: revenue - expenses, top_wash_types: topWash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Detailed Sales Report Endpoint
router.get('/sales-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const rawBills = await db.prepare(`
      SELECT b.*, j.customer_type, j.workshop_id, j.vehicle_id, v.reg_number, v.brand, v.model
      FROM bills b
      JOIN jobs j ON j.id = b.job_id
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      WHERE b.status = 'paid'
      ORDER BY b.id DESC
    `).all();

    const bills = rawBills.filter(b => {
      const d = (b.paid_at || b.created_at || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    let cashSales = 0;
    let gpaySales = 0;
    let retailSales = 0;
    let workshopSales = 0;

    bills.forEach(b => {
      const amt = Number(b.final_amount) || 0;
      if (b.payment_method === 'cash') cashSales += amt;
      else gpaySales += amt;

      if (b.customer_type === 'workshop') workshopSales += amt;
      else retailSales += amt;
    });

    res.json({
      from: startDate,
      to: endDate,
      total_sales: cashSales + gpaySales,
      cash_sales: cashSales,
      gpay_sales: gpaySales,
      retail_sales: retailSales,
      workshop_sales: workshopSales,
      bills_count: bills.length,
      average_ticket: bills.length > 0 ? Math.round((cashSales + gpaySales) / bills.length) : 0,
      bills
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Expense Report Endpoint
router.get('/expense-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const rawExpenses = await db.prepare(`
      SELECT * FROM expenses ORDER BY date DESC, id DESC
    `).all();

    const expenses = rawExpenses.filter(e => {
      const d = (e.date || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    let cashExpenses = 0;
    let gpayExpenses = 0;
    const categoryTotals = {};

    expenses.forEach(e => {
      const amt = Number(e.amount) || 0;
      if (e.payment_method === 'cash') cashExpenses += amt;
      else gpayExpenses += amt;

      const cat = e.category || 'other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
    });

    res.json({
      from: startDate,
      to: endDate,
      total_expenses: cashExpenses + gpayExpenses,
      cash_expenses: cashExpenses,
      gpay_expenses: gpayExpenses,
      category_totals: categoryTotals,
      expenses_count: expenses.length,
      expenses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Car Report Endpoint
router.get('/car-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const allJobs = await db.prepare(`
      SELECT j.*, v.reg_number, v.segment, v.brand, v.model, wt.name as wash_type_name
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id
      JOIN wash_types wt ON wt.id = j.wash_type_id
      WHERE (v.segment IS NULL OR (v.segment != 'bike' AND v.segment != 'scooter'))
      ORDER BY j.id DESC
    `).all();

    const rawJobs = allJobs.filter(j => {
      const d = (j.entry_time || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    const segmentCounts = {};
    const washTypeCounts = {};
    let totalRevenue = 0;

    rawJobs.forEach(j => {
      const seg = j.segment || 'hatchback';
      segmentCounts[seg] = (segmentCounts[seg] || 0) + 1;

      const wtName = j.wash_type_name || 'Wash';
      washTypeCounts[wtName] = (washTypeCounts[wtName] || 0) + 1;

      if (j.payment_status === 'settled') {
        totalRevenue += (Number(j.offer_price) || Number(j.paid_amount) || 0);
      }
    });

    res.json({
      from: startDate,
      to: endDate,
      total_cars: rawJobs.length,
      total_revenue: totalRevenue,
      segment_counts: segmentCounts,
      wash_type_counts: washTypeCounts,
      jobs: rawJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Bike Report Endpoint
router.get('/bike-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const allJobs = await db.prepare(`
      SELECT j.*, v.reg_number, v.segment, v.brand, v.model, wt.name as wash_type_name
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id
      JOIN wash_types wt ON wt.id = j.wash_type_id
      WHERE (v.segment = 'bike' OR v.segment = 'scooter')
      ORDER BY j.id DESC
    `).all();

    const rawJobs = allJobs.filter(j => {
      const d = (j.entry_time || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    let bikeCount = 0;
    let scooterCount = 0;
    let chainLubeCount = 0;
    let chainLubeRevenue = 0;
    let totalRevenue = 0;
    const washTypeCounts = {};

    rawJobs.forEach(j => {
      if (j.segment === 'scooter') scooterCount++;
      else bikeCount++;

      if (j.has_chain_lube) {
        chainLubeCount++;
        chainLubeRevenue += Number(j.chain_lube_price || 150);
      }

      const wtName = j.wash_type_name || 'Bike Wash';
      washTypeCounts[wtName] = (washTypeCounts[wtName] || 0) + 1;

      if (j.payment_status === 'settled') {
        totalRevenue += (Number(j.offer_price) || Number(j.paid_amount) || 0);
      }
    });

    res.json({
      from: startDate,
      to: endDate,
      total_bikes: rawJobs.length,
      bike_count: bikeCount,
      scooter_count: scooterCount,
      chain_lube_count: chainLubeCount,
      chain_lube_revenue: chainLubeRevenue,
      total_revenue: totalRevenue,
      wash_type_counts: washTypeCounts,
      jobs: rawJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Car Workshop Report Endpoint
router.get('/car-workshop-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const workshops = await db.prepare("SELECT * FROM workshops WHERE type = 'Car Workshop' ORDER BY name ASC").all();
    const workshopSummary = [];

    for (const w of workshops) {
      const allJobs = await db.prepare(`
        SELECT j.*, v.reg_number, v.brand, v.model, wt.name as wash_type_name
        FROM jobs j
        JOIN vehicles v ON v.id = j.vehicle_id
        JOIN wash_types wt ON wt.id = j.wash_type_id
        WHERE j.customer_type = 'workshop' AND j.workshop_id = ?
        ORDER BY j.id DESC
      `).all(w.id);

      const jobs = allJobs.filter(j => {
        const d = (j.entry_time || '').slice(0, 10);
        return d >= startDate && d <= endDate;
      });

      let totalAmount = 0;
      let paidAmount = 0;
      let unpaidAmount = 0;

      jobs.forEach(j => {
        const price = Number(j.offer_price) || 0;
        totalAmount += price;
        const paid = j.payment_status === 'settled' ? price : Number(j.paid_amount || 0);
        paidAmount += paid;
        unpaidAmount += Math.max(0, price - paid);
      });

      workshopSummary.push({
        ...w,
        cars_count: jobs.length,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        unpaid_amount: unpaidAmount,
        jobs
      });
    }

    res.json({
      from: startDate,
      to: endDate,
      workshops_count: workshops.length,
      workshops: workshopSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Bike Workshop Report Endpoint
router.get('/bike-workshop-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const workshops = await db.prepare("SELECT * FROM workshops WHERE type = 'Bike Workshop' ORDER BY name ASC").all();
    const workshopSummary = [];

    for (const w of workshops) {
      const allJobs = await db.prepare(`
        SELECT j.*, v.reg_number, v.brand, v.model, wt.name as wash_type_name
        FROM jobs j
        JOIN vehicles v ON v.id = j.vehicle_id
        JOIN wash_types wt ON wt.id = j.wash_type_id
        WHERE j.customer_type = 'workshop' AND j.workshop_id = ?
        ORDER BY j.id DESC
      `).all(w.id);

      const jobs = allJobs.filter(j => {
        const d = (j.entry_time || '').slice(0, 10);
        return d >= startDate && d <= endDate;
      });

      let totalAmount = 0;
      let paidAmount = 0;
      let unpaidAmount = 0;

      jobs.forEach(j => {
        const price = Number(j.offer_price) || 0;
        totalAmount += price;
        const paid = j.payment_status === 'settled' ? price : Number(j.paid_amount || 0);
        paidAmount += paid;
        unpaidAmount += Math.max(0, price - paid);
      });

      workshopSummary.push({
        ...w,
        bikes_count: jobs.length,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        unpaid_amount: unpaidAmount,
        jobs
      });
    }

    res.json({
      from: startDate,
      to: endDate,
      workshops_count: workshops.length,
      workshops: workshopSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Attendance Report Endpoint
router.get('/attendance-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const employees = await db.prepare("SELECT id, name, role, phone FROM employees WHERE active = 1 ORDER BY name ASC").all();
    const allRecords = await db.prepare(`
      SELECT a.*, e.name as employee_name
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      ORDER BY a.date DESC
    `).all();

    const records = allRecords.filter(r => {
      const d = (r.date || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    let presentCount = 0;
    let absentCount = 0;
    let halfDayCount = 0;
    let totalLateMinutes = 0;
    let totalOvertimeMinutes = 0;

    records.forEach(r => {
      if (r.status === 'present') presentCount++;
      else if (r.status === 'absent') absentCount++;
      else if (r.status === 'half_day') halfDayCount++;

      totalLateMinutes += Number(r.late_minutes) || 0;
      totalOvertimeMinutes += Number(r.overtime_minutes) || 0;
    });

    res.json({
      from: startDate,
      to: endDate,
      total_employees: employees.length,
      total_records: records.length,
      present_count: presentCount,
      absent_count: absentCount,
      half_day_count: halfDayCount,
      total_late_minutes: totalLateMinutes,
      total_overtime_minutes: totalOvertimeMinutes,
      employees,
      records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Salary Report Endpoint
router.get('/salary-report', async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = Number(month) || (new Date().getMonth() + 1);
    const y = Number(year) || new Date().getFullYear();

    const payrolls = await db.prepare(`
      SELECT p.*, e.name as employee_name, e.role, e.monthly_salary, e.daily_wage
      FROM payroll p
      JOIN employees e ON e.id = p.employee_id
      WHERE p.month = ? AND p.year = ?
      ORDER BY e.name ASC
    `).all(m, y);

    let totalNetPay = 0;
    let totalAdvancesDeducted = 0;
    let totalOvertimePay = 0;
    let totalBaseSalary = 0;

    payrolls.forEach(p => {
      totalNetPay += Number(p.net_pay) || 0;
      totalAdvancesDeducted += Number(p.advance_deduction) || 0;
      totalOvertimePay += Number(p.overtime_pay) || 0;
      totalBaseSalary += Number(p.base_salary) || 0;
    });

    res.json({
      month: m,
      year: y,
      total_employees: payrolls.length,
      total_net_pay: totalNetPay,
      total_advances_deducted: totalAdvancesDeducted,
      total_overtime_pay: totalOvertimePay,
      total_base_salary: totalBaseSalary,
      payrolls
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Customers Report Endpoint
router.get('/customers-report', async (req, res) => {
  try {
    const { q } = req.query;
    let customers = await db.prepare("SELECT * FROM customers ORDER BY reward_points DESC, id DESC").all();
    if (q) {
      const search = q.toLowerCase().trim();
      customers = customers.filter(c =>
        (c.name || '').toLowerCase().includes(search) ||
        (c.phone || '').toLowerCase().includes(search)
      );
    }

    const customerSummary = [];
    let totalPoints = 0;

    for (const c of customers) {
      totalPoints += Number(c.reward_points) || 0;
      const vehicles = await db.prepare("SELECT * FROM vehicles WHERE customer_id = ?").all(c.id);
      customerSummary.push({
        ...c,
        vehicles_count: vehicles.length,
        vehicles
      });
    }

    res.json({
      total_customers: customers.length,
      total_points_balance: totalPoints,
      customers: customerSummary
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Salary Advance Report Endpoint
router.get('/salary-advance-report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const startDate = from || new Date().toISOString().slice(0, 10);
    const endDate = to || new Date().toISOString().slice(0, 10);

    const allAdvances = await db.prepare(`
      SELECT a.*, e.name as employee_name, e.role
      FROM advances a
      JOIN employees e ON e.id = a.employee_id
      ORDER BY a.date DESC, a.id DESC
    `).all();

    const advances = allAdvances.filter(a => {
      const d = (a.date || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    let cashAdvances = 0;
    let gpayAdvances = 0;

    advances.forEach(a => {
      const amt = Number(a.amount) || 0;
      if (a.payment_method === 'cash') cashAdvances += amt;
      else gpayAdvances += amt;
    });

    res.json({
      from: startDate,
      to: endDate,
      total_advances: cashAdvances + gpayAdvances,
      cash_advances: cashAdvances,
      gpay_advances: gpayAdvances,
      advances_count: advances.length,
      advances
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
