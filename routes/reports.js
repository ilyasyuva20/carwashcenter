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

    const existing = await db.prepare('SELECT * FROM daily_opening_balances WHERE date = ?').get(targetDate);
    if (existing) {
      await db.prepare('UPDATE daily_opening_balances SET opening_cash = ?, opening_gpay = ? WHERE date = ?')
        .run(opCash, opGpay, targetDate);
    } else {
      await db.prepare('INSERT INTO daily_opening_balances (date, opening_cash, opening_gpay) VALUES (?, ?, ?)')
        .run(targetDate, opCash, opGpay);
    }

    res.json({ ok: true });
  } catch (err) {
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
    const bills = await db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at >= ? AND paid_at <= ?`)
      .all(from, `${to}T23:59:59`);
    const cash = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + Number(b.final_amount), 0);
    const gpay = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + Number(b.final_amount), 0);
    const revenue = cash + gpay;

    const expensesRow = await db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM expenses WHERE date >= ? AND date <= ?`).get(from, to);
    const expenses = expensesRow ? Number(expensesRow.s) : 0;

    const topWash = await db.prepare(`
      SELECT wt.name, COUNT(*) as c, SUM(b.final_amount) as revenue
      FROM bills b JOIN jobs j ON j.id = b.job_id JOIN wash_types wt ON wt.id = j.wash_type_id
      WHERE b.status='paid' AND b.paid_at >= ? AND b.paid_at <= ?
      GROUP BY wt.name ORDER BY c DESC
    `).all(from, `${to}T23:59:59`);

    res.json({ from, to, vehicles: bills.length, cash_payment: cash, gpay_payment: gpay, revenue, expenses, net: revenue - expenses, top_wash_types: topWash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
