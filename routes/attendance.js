const express = require('express');
const router = express.Router();
const db = require('../db');

const SHIFT_START = '09:30'; // used to compute lateness
const SHIFT_END = '19:30'; // used to compute overtime

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Get attendance for a date (all employees), or for one employee across a month
router.get('/', (req, res) => {
  const { date, employee_id, month, year } = req.query;
  if (employee_id && month && year) {
    const rows = db.prepare(
      `SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date`
    ).all(employee_id, `${year}-${String(month).padStart(2, '0')}-%`);
    return res.json(rows);
  }
  if (date) {
    const rows = db.prepare(
      `SELECT a.*, e.name as employee_name FROM attendance a
       JOIN employees e ON e.id = a.employee_id WHERE a.date = ?`
    ).all(date);
    return res.json(rows);
  }
  res.status(400).json({ error: 'Provide date, or employee_id + month + year' });
});

// Clock in
router.post('/clock-in', (req, res) => {
  const { employee_id, date, time } = req.body;
  const lateMin = Math.max(0, toMinutes(time) - toMinutes(SHIFT_START));
  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
  if (existing) {
    db.prepare('UPDATE attendance SET check_in=?, late_minutes=?, status=? WHERE id=?')
      .run(time, lateMin, 'present', existing.id);
  } else {
    db.prepare(
      'INSERT INTO attendance (employee_id, date, status, check_in, late_minutes) VALUES (?, ?, ?, ?, ?)'
    ).run(employee_id, date, 'present', time, lateMin);
  }
  res.json(db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date));
});

// Clock out
router.post('/clock-out', (req, res) => {
  const { employee_id, date, time } = req.body;
  const row = db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
  if (!row) return res.status(404).json({ error: 'No clock-in found for this date' });
  const overtimeMin = Math.max(0, toMinutes(time) - toMinutes(SHIFT_END));
  db.prepare('UPDATE attendance SET check_out=?, overtime_minutes=? WHERE id=?')
    .run(time, overtimeMin, row.id);
  res.json(db.prepare('SELECT * FROM attendance WHERE id=?').get(row.id));
});

// Mark leave / absent / half-day manually
router.post('/mark', (req, res) => {
  const { employee_id, date, status } = req.body; // status: leave, absent, half_day, present
  const existing = db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
  if (existing) {
    db.prepare('UPDATE attendance SET status=? WHERE id=?').run(status, existing.id);
  } else {
    db.prepare('INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)').run(employee_id, date, status);
  }
  res.json(db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date));
});

module.exports = router;
