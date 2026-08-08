const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const { from, to, category } = req.query;
  let rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all();
  if (from) rows = rows.filter(r => r.date >= from);
  if (to) rows = rows.filter(r => r.date <= to);
  if (category) rows = rows.filter(r => r.category === category);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { category, amount, note, date, payment_method } = req.body;
  const info = db.prepare(
    'INSERT INTO expenses (category, amount, note, date, payment_method) VALUES (?, ?, ?, ?, ?)'
  ).run(category, amount, note || null, date, payment_method || 'gpay');
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
