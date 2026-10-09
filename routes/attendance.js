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
    const { employee_id, date, time, shift_start } = req.body;
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    const emp = await db.prepare('SELECT default_shift FROM employees WHERE id=?').get(employee_id);
    const expectedShift = shift_start || (existing && existing.shift_start) || (emp && emp.default_shift) || '08:00';
    if (shift_start) {
      try {
        await db.prepare('UPDATE employees SET default_shift = ? WHERE id = ?').run(shift_start, employee_id);
      } catch (e) {}
    }
    const lateMin = Math.max(0, toMinutes(time) - toMinutes(expectedShift));
    if (existing) {
      await db.prepare('UPDATE attendance SET check_in=?, late_minutes=?, status=?, shift_start=? WHERE id=?')
        .run(time, lateMin, 'present', expectedShift, existing.id);
    } else {
      await db.prepare(
        'INSERT INTO attendance (employee_id, date, status, check_in, late_minutes, shift_start) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(employee_id, date, 'present', time, lateMin, expectedShift);
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
    const { employee_id, date, status, shift_start } = req.body; // status: leave, absent, half_day, present
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    const emp = await db.prepare('SELECT default_shift FROM employees WHERE id=?').get(employee_id);
    const expectedShift = shift_start || (existing && existing.shift_start) || (emp && emp.default_shift) || '08:00';
    if (shift_start) {
      try {
        await db.prepare('UPDATE employees SET default_shift = ? WHERE id = ?').run(shift_start, employee_id);
      } catch (e) {}
    }
    if (existing) {
      await db.prepare('UPDATE attendance SET status=?, shift_start=? WHERE id=?').run(status, expectedShift, existing.id);
    } else {
      await db.prepare('INSERT INTO attendance (employee_id, date, status, shift_start) VALUES (?, ?, ?, ?)').run(employee_id, date, status, expectedShift);
    }
    const result = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update attendance record details (late_minutes, overtime_minutes, status, check_in, check_out, shift_start)
router.post('/update', async (req, res) => {
  try {
    const { employee_id, date, status, late_minutes, overtime_minutes, check_in, check_out, shift_start } = req.body;
    const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    const emp = await db.prepare('SELECT default_shift FROM employees WHERE id=?').get(employee_id);

    let newCin = check_in !== undefined ? check_in : (existing ? existing.check_in : null);
    let newCout = check_out !== undefined ? check_out : (existing ? existing.check_out : null);
    let newStatus = status !== undefined ? status : (existing ? existing.status : (newCin ? 'present' : 'not_marked'));
    let newShift = shift_start !== undefined ? shift_start : (existing && existing.shift_start ? existing.shift_start : ((emp && emp.default_shift) || '08:00'));

    if (shift_start) {
      try {
        await db.prepare('UPDATE employees SET default_shift = ? WHERE id = ?').run(shift_start, employee_id);
      } catch (e) {}
    }

    // Calculate late_minutes: explicitly provided > computed from check_in & shift_start > 0
    let newLate;
    if (late_minutes !== undefined) {
      newLate = Number(late_minutes);
    } else if (newCin && String(newCin).trim() !== '') {
      newLate = Math.max(0, toMinutes(newCin) - toMinutes(newShift));
    } else {
      newLate = 0;
    }

    // Calculate overtime_minutes: explicitly provided > computed from check_out > existing/0
    let newOt;
    if (overtime_minutes !== undefined) {
      newOt = Number(overtime_minutes);
    } else if (newCout) {
      newOt = Math.max(0, toMinutes(newCout) - toMinutes(SHIFT_END));
    } else {
      newOt = existing ? existing.overtime_minutes : 0;
    }

    if (existing) {
      await db.prepare(`
        UPDATE attendance 
        SET status = ?, late_minutes = ?, overtime_minutes = ?, check_in = ?, check_out = ?, shift_start = ?
        WHERE id = ?
      `).run(newStatus, newLate, newOt, newCin, newCout, newShift, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO attendance (employee_id, date, status, late_minutes, overtime_minutes, check_in, check_out, shift_start)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(employee_id, date, newStatus, newLate, newOt, newCin, newCout, newShift);
    }
    const result = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(employee_id, date);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


