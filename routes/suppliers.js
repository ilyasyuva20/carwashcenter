const express = require('express');
const router = express.Router();
const db = require('../db');

// List all suppliers with balance metrics
router.get('/', async (req, res) => {
  try {
    const suppliers = await db.prepare("SELECT * FROM suppliers ORDER BY id DESC").all();
    const result = [];

    for (const s of suppliers) {
      const purchases = await db.prepare("SELECT * FROM supplier_purchases WHERE supplier_id = ?").all(s.id);
      const payments = await db.prepare("SELECT * FROM supplier_payments WHERE supplier_id = ?").all(s.id);

      let totalPurchases = 0;
      let totalPaid = 0;

      purchases.forEach(p => {
        totalPurchases += Number(p.total_amount) || 0;
        totalPaid += Number(p.paid_amount) || 0;
      });

      payments.forEach(p => {
        totalPaid += Number(p.amount) || 0;
      });

      const pendingBalance = Math.max(0, totalPurchases - totalPaid);

      result.push({
        ...s,
        purchases_count: purchases.length,
        total_purchases: totalPurchases,
        total_paid: totalPaid,
        pending_balance: pendingBalance
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add new supplier
router.post('/', async (req, res) => {
  try {
    const {
      name,
      company_name,
      category,
      gst,
      location,
      contact_number,
      sales_person_name,
      sales_person_number
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Supplier name is required' });

    const createdAt = new Date().toISOString();

    const stmt = await db.prepare(`
      INSERT INTO suppliers (
        name, company_name, category, gst, location, contact_number, sales_person_name, sales_person_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      company_name || '',
      category || 'Other',
      gst || '',
      location || '',
      contact_number || '',
      sales_person_name || '',
      sales_person_number || '',
      createdAt
    );

    res.json({ ok: true, id: stmt.lastInsertRowid });
  } catch (err) {
    console.error('Error adding supplier:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single supplier details with full purchase and payment history
router.get('/:id', async (req, res) => {
  try {
    const supplier = await db.prepare("SELECT * FROM suppliers WHERE id = ?").get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const purchases = await db.prepare("SELECT * FROM supplier_purchases WHERE supplier_id = ? ORDER BY id DESC").all(req.params.id);
    const payments = await db.prepare("SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY id DESC").all(req.params.id);

    let totalPurchases = 0;
    let totalPaid = 0;

    purchases.forEach(p => {
      totalPurchases += Number(p.total_amount) || 0;
      totalPaid += Number(p.paid_amount) || 0;
    });

    payments.forEach(p => {
      totalPaid += Number(p.amount) || 0;
    });

    const pendingBalance = Math.max(0, totalPurchases - totalPaid);

    res.json({
      ...supplier,
      total_purchases: totalPurchases,
      total_paid: totalPaid,
      pending_balance: pendingBalance,
      purchases,
      payments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit supplier details
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      company_name,
      category,
      gst,
      location,
      contact_number,
      sales_person_name,
      sales_person_number
    } = req.body;

    await db.prepare(`
      UPDATE suppliers SET
        name = ?, company_name = ?, category = ?, gst = ?, location = ?,
        contact_number = ?, sales_person_name = ?, sales_person_number = ?
      WHERE id = ?
    `).run(
      name,
      company_name || '',
      category || 'Other',
      gst || '',
      location || '',
      contact_number || '',
      sales_person_name || '',
      sales_person_number || '',
      req.params.id
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete supplier
router.delete('/:id', async (req, res) => {
  try {
    await db.prepare("DELETE FROM suppliers WHERE id = ?").run(req.params.id);
    await db.prepare("DELETE FROM supplier_purchases WHERE supplier_id = ?").run(req.params.id);
    await db.prepare("DELETE FROM supplier_payments WHERE supplier_id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a new purchase from a supplier (and auto-add expense if paid amount > 0)
router.post('/:id/purchases', async (req, res) => {
  try {
    const supplierId = req.params.id;
    const supplier = await db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const {
      item_details,
      category,
      total_amount,
      paid_amount,
      payment_method,
      date,
      note
    } = req.body;

    const totalAmt = Number(total_amount) || 0;
    const paidAmt = Number(paid_amount) || 0;
    const pendingAmt = Math.max(0, totalAmt - paidAmt);
    const payMethod = payment_method || 'cash';
    const txnDate = date || new Date().toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();

    let expenseId = null;

    // Automatically create expense record for the paid amount on that day
    if (paidAmt > 0) {
      const expNote = `Supplier Purchase: ${supplier.name} (${item_details || category || 'Materials'})`;
      const expStmt = await db.prepare(`
        INSERT INTO expenses (category, amount, note, date, payment_method)
        VALUES (?, ?, ?, ?, ?)
      `).run('purchase', paidAmt, expNote, txnDate, payMethod);
      expenseId = expStmt.lastInsertRowid;
    }

    const purchaseStmt = await db.prepare(`
      INSERT INTO supplier_purchases (
        supplier_id, item_details, category, total_amount, paid_amount, pending_amount, payment_method, date, note, expense_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      supplierId,
      item_details || '',
      category || supplier.category || 'Other',
      totalAmt,
      paidAmt,
      pendingAmt,
      payMethod,
      txnDate,
      note || '',
      expenseId,
      createdAt
    );

    res.json({ ok: true, id: purchaseStmt.lastInsertRowid, expense_id: expenseId });
  } catch (err) {
    console.error('Error adding supplier purchase:', err);
    res.status(500).json({ error: err.message });
  }
});

// Record a payment / settlement towards a supplier's pending balance (and auto-add expense)
router.post('/:id/payments', async (req, res) => {
  try {
    const supplierId = req.params.id;
    const supplier = await db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const {
      amount,
      payment_method,
      date,
      note,
      purchase_id
    } = req.body;

    const pAmt = Number(amount) || 0;
    if (pAmt <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0' });

    const payMethod = payment_method || 'cash';
    const txnDate = date || new Date().toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();

    // Automatically log expense for this payment on that day
    const expNote = `Supplier Payout: ${supplier.name} ${note ? '(' + note + ')' : ''}`;
    const expStmt = await db.prepare(`
      INSERT INTO expenses (category, amount, note, date, payment_method)
      VALUES (?, ?, ?, ?, ?)
    `).run('purchase', pAmt, expNote, txnDate, payMethod);

    const expenseId = expStmt.lastInsertRowid;

    const paymentStmt = await db.prepare(`
      INSERT INTO supplier_payments (
        supplier_id, purchase_id, amount, payment_method, date, note, expense_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      supplierId,
      purchase_id || null,
      pAmt,
      payMethod,
      txnDate,
      note || '',
      expenseId,
      createdAt
    );

    res.json({ ok: true, id: paymentStmt.lastInsertRowid, expense_id: expenseId });
  } catch (err) {
    console.error('Error recording supplier payment:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
