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
router.get('/', async (req, res) => {
  try {
    const { date, employee_id, month, year } = req.query;
    if (employee_id && month && year) {
      const rows = await db.prepare(
        `SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date`
      ).all(employee_id, `${year}-${String(month).padStart(2, '0')}-%`);
      return res.json(rows);
    }
    if (date) {
      const rows = await db.prepare(
        `SELECT a.*, e.name as employee_name FROM attendance a
         JOIN employees e ON e.id = a.employee_id WHERE a.date = ?`
      ).all(date);
      return res.json(rows);
    }
    res.status(400).json({ error: 'Provide date, or employee_id + month + year' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clock in
router.post('/clock-in', async (req, res) => {
  try {
    const { employee_id, date, time } = req.body;
    const lateMin = Math.max(0, toMinutes(time) - toMinutes(SHIFT_START));
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    if (existing) {
      await db.prepare('UPDATE attendance SET check_in=?, late_minutes=?, status=? WHERE id=?')
        .run(time, lateMin, 'present', existing.id);
    } else {
      await db.prepare(
        'INSERT INTO attendance (employee_id, date, status, check_in, late_minutes) VALUES (?, ?, ?, ?, ?)'
      ).run(employee_id, date, 'present', time, lateMin);
    }
    const result = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clock out
router.post('/clock-out', async (req, res) => {
  try {
    const { employee_id, date, time } = req.body;
    const row = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    if (!row) return res.status(404).json({ error: 'No clock-in found for this date' });
    const overtimeMin = Math.max(0, toMinutes(time) - toMinutes(SHIFT_END));
    await db.prepare('UPDATE attendance SET check_out=?, overtime_minutes=? WHERE id=?')
      .run(time, overtimeMin, row.id);
    const updated = await db.prepare('SELECT * FROM attendance WHERE id=?').get(row.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark leave / absent / half-day manually
router.post('/mark', async (req, res) => {
  try {
    const { employee_id, date, status } = req.body; // status: leave, absent, half_day, present
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    if (existing) {
      await db.prepare('UPDATE attendance SET status=? WHERE id=?').run(status, existing.id);
    } else {
      await db.prepare('INSERT INTO attendance (employee_id, date, status) VALUES (?, ?, ?)').run(employee_id, date, status);
    }
    const result = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
