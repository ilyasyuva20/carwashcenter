const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { from, to, category } = req.query;
    let rows = await db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all();
    if (from) rows = rows.filter(r => r.date >= from);
    if (to) rows = rows.filter(r => r.date <= to);
    if (category) rows = rows.filter(r => r.category === category);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { category, amount, note, date, payment_method } = req.body;
    const info = await db.prepare(
      'INSERT INTO expenses (category, amount, note, date, payment_method) VALUES (?, ?, ?, ?, ?)'
    ).run(category, amount, note || null, date, payment_method || 'gpay');
    
    const created = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
