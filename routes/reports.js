const express = require('express');
const router = express.Router();
const db = require('../db');

function summaryFor(date) {
  const bills = db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at LIKE ?`).all(`${date}%`);
  const cash = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + b.final_amount, 0);
  const gpay = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + b.final_amount, 0);
  const revenue = cash + gpay;
  const jobsToday = db.prepare(`SELECT COUNT(*) c FROM jobs WHERE entry_time LIKE ?`).get(`${date}%`).c;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date = ?`).get(date).s;
  const unpaidBills = db.prepare(`SELECT COUNT(*) c FROM bills WHERE status='unpaid'`).get().c;
  return { date, vehicles: jobsToday, cash_payment: cash, gpay_payment: gpay, revenue, expenses, unpaid_bills: unpaidBills, bills_count: bills.length };
}

function ledgerFor(date) {
  const op = db.prepare('SELECT opening_cash, opening_gpay FROM daily_opening_balances WHERE date = ?').get(date) || { opening_cash: 0, opening_gpay: 0 };
  
  const bills = db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at LIKE ?`).all(`${date}%`);
  const cashSales = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + b.final_amount, 0);
  const gpaySales = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + b.final_amount, 0);
  const totalSales = cashSales + gpaySales;

  const expenses = db.prepare(`SELECT * FROM expenses WHERE date = ? ORDER BY id DESC`).all(date);
  const cashExpenses = expenses.filter(e => e.payment_method === 'cash').reduce((s, e) => s + e.amount, 0);
  const gpayExpenses = expenses.filter(e => e.payment_method !== 'cash').reduce((s, e) => s + e.amount, 0);
  const totalExpenses = cashExpenses + gpayExpenses;

  const advances = db.prepare(`SELECT * FROM advances WHERE date LIKE ?`).all(`${date}%`);
  const cashAdvances = advances.filter(a => a.payment_method === 'cash').reduce((s, a) => s + a.amount, 0);
  const gpayAdvances = advances.filter(a => a.payment_method === 'gpay').reduce((s, a) => s + a.amount, 0);
  const totalAdvances = cashAdvances + gpayAdvances;

  const closingCash = op.opening_cash + cashSales - cashExpenses - cashAdvances;
  const closingGpay = op.opening_gpay + gpaySales - gpayExpenses - gpayAdvances;

  return {
    date,
    opening_cash: op.opening_cash,
    opening_gpay: op.opening_gpay,
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

router.get('/today', (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.json({ ...summaryFor(date), ledger: ledgerFor(date) });
});

router.get('/ledger', (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().slice(0, 10);
  res.json(ledgerFor(targetDate));
});

router.post('/opening-balance', (req, res) => {
  try {
    const { date, opening_cash, opening_gpay } = req.body;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO daily_opening_balances (date, opening_cash, opening_gpay)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET opening_cash = excluded.opening_cash, opening_gpay = excluded.opening_gpay
    `).run(targetDate, Number(opening_cash) || 0, Number(opening_gpay) || 0);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily', (req, res) => {
  const { date } = req.query;
  res.json(summaryFor(date || new Date().toISOString().slice(0, 10)));
});

router.get('/range', (req, res) => {
  const { from, to } = req.query;
  const bills = db.prepare(`SELECT * FROM bills WHERE status='paid' AND paid_at >= ? AND paid_at <= ?`)
    .all(from, `${to}T23:59:59`);
  const cash = bills.filter(b => b.payment_method === 'cash').reduce((s, b) => s + b.final_amount, 0);
  const gpay = bills.filter(b => b.payment_method === 'gpay').reduce((s, b) => s + b.final_amount, 0);
  const revenue = cash + gpay;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date >= ? AND date <= ?`).get(from, to).s;

  const topWash = db.prepare(`
    SELECT wt.name, COUNT(*) c, SUM(b.final_amount) revenue
    FROM bills b JOIN jobs j ON j.id = b.job_id JOIN wash_types wt ON wt.id = j.wash_type_id
    WHERE b.status='paid' AND b.paid_at >= ? AND b.paid_at <= ?
    GROUP BY wt.name ORDER BY c DESC
  `).all(from, `${to}T23:59:59`);

  res.json({ from, to, vehicles: bills.length, cash_payment: cash, gpay_payment: gpay, revenue, expenses, net: revenue - expenses, top_wash_types: topWash });
});

module.exports = router;
