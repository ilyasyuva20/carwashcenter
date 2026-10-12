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

// Bulk mark attendance across date range (e.g. Oct 1 - Oct 10)
router.post('/bulk-mark', async (req, res) => {
  try {
    const { start_date, end_date, employee_ids, status, skip_sundays, override_existing } = req.body;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    let emps = [];
    if (Array.isArray(employee_ids) && employee_ids.length > 0) {
      const placeholders = employee_ids.map(() => '?').join(',');
      emps = await db.prepare(`SELECT * FROM employees WHERE id IN (${placeholders})`).all(...employee_ids);
    } else {
      emps = await db.prepare('SELECT * FROM employees WHERE active = 1').all();
    }

    const start = new Date(start_date + 'T00:00:00');
    const end = new Date(end_date + 'T00:00:00');
    let count = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (skip_sundays && d.getDay() === 0) continue;

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;

      for (const emp of emps) {
        const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(emp.id, dateStr);
        if (existing && !override_existing) continue;

        const expectedShift = (existing && existing.shift_start) || emp.default_shift || '08:00';
        const targetStatus = status || 'present';

        if (existing) {
          await db.prepare('UPDATE attendance SET status=?, shift_start=? WHERE id=?').run(targetStatus, expectedShift, existing.id);
        } else {
          await db.prepare('INSERT INTO attendance (employee_id, date, status, shift_start) VALUES (?, ?, ?, ?)').run(emp.id, dateStr, targetStatus, expectedShift);
        }
        count++;
      }
    }

    res.json({ success: true, records_updated: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk import attendance records from parsed CSV/Excel JSON
router.post('/import-csv', async (req, res) => {
  try {
    const { date: targetDate, records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }

    const allEmps = await db.prepare('SELECT * FROM employees ORDER BY name ASC').all();
    let count = 0;

    for (const rec of records) {
      const dateStr = String(rec.date || targetDate || '').trim();
      if (!dateStr) continue;

      let emp = null;
      if (rec.employee_id) {
        emp = allEmps.find(e => e.id == rec.employee_id);
      }
      if (!emp && rec.phone) {
        const cleanPhone = String(rec.phone).replace(/\D/g, '');
        if (cleanPhone) {
          emp = allEmps.find(e => (e.phone || '').replace(/\D/g, '').includes(cleanPhone));
        }
      }
      if (!emp && rec.employee_name) {
        const q = String(rec.employee_name).toLowerCase().trim();
        emp = allEmps.find(e => (e.name || '').toLowerCase().trim() === q || (e.name || '').toLowerCase().includes(q));
      }
      if (!emp && rec.sl_no && !isNaN(rec.sl_no)) {
        const idx = Number(rec.sl_no) - 1;
        if (idx >= 0 && idx < allEmps.length) {
          emp = allEmps[idx];
        }
      }

      if (!emp) continue;

      const status = (rec.status || 'present').toLowerCase().trim();
      const shiftStart = rec.shift_start || emp.default_shift || '08:00';
      const checkIn = rec.check_in || null;
      const checkOut = rec.check_out || null;
      const lateMins = rec.late_minutes !== undefined ? Number(rec.late_minutes) : 0;

      const existing = await db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(emp.id, dateStr);

      if (existing) {
        await db.prepare(`
          UPDATE attendance
          SET status=?, check_in=?, check_out=?, late_minutes=?, shift_start=?
          WHERE id=?
        `).run(status, checkIn || existing.check_in, checkOut || existing.check_out, lateMins, shiftStart, existing.id);
      } else {
        await db.prepare(`
          INSERT INTO attendance (employee_id, date, status, check_in, check_out, late_minutes, shift_start)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(emp.id, dateStr, status, checkIn, checkOut, lateMins, shiftStart);
      }
      count++;
    }

    res.json({ success: true, records_imported: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk save all staff attendance for a given date in a single API call
router.post('/bulk-save', async (req, res) => {
  try {
    const { date: targetDate, records } = req.body;
    if (!targetDate || !Array.isArray(records)) {
      return res.status(400).json({ error: 'date and records array are required' });
    }

    let savedCount = 0;
    for (const rec of records) {
      if (!rec.employee_id) continue;

      const emp = await db.prepare('SELECT default_shift FROM employees WHERE id=?').get(rec.employee_id);
      const shiftStart = rec.shift_start || (emp && emp.default_shift) || '08:00';
      const status = rec.status || 'not_marked';
      const checkIn = rec.check_in || null;
      const checkOut = rec.check_out || null;

      // Update default_shift if updated
      if (rec.shift_start) {
        try {
          await db.prepare('UPDATE employees SET default_shift = ? WHERE id = ?').run(rec.shift_start, rec.employee_id);
        } catch (e) {}
      }

      // Compute late minutes if check_in exists
      let lateMins = Number(rec.late_minutes) || 0;
      if (checkIn && String(checkIn).trim() !== '') {
        lateMins = Math.max(0, toMinutes(checkIn) - toMinutes(shiftStart));
      }

      // Compute overtime minutes if check_out exists
      let otMins = Number(rec.overtime_minutes) || 0;
      if (checkOut && String(checkOut).trim() !== '') {
        otMins = Math.max(0, toMinutes(checkOut) - toMinutes(SHIFT_END));
      }

      const existing = await db.prepare('SELECT id FROM attendance WHERE employee_id=? AND date=?').get(rec.employee_id, targetDate);

      if (existing) {
        await db.prepare(`
          UPDATE attendance
          SET status=?, check_in=?, check_out=?, late_minutes=?, overtime_minutes=?, shift_start=?
          WHERE id=?
        `).run(status, checkIn, checkOut, lateMins, otMins, shiftStart, existing.id);
      } else {
        await db.prepare(`
          INSERT INTO attendance (employee_id, date, status, check_in, check_out, late_minutes, overtime_minutes, shift_start)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(rec.employee_id, targetDate, status, checkIn, checkOut, lateMins, otMins, shiftStart);
      }
      savedCount++;
    }

    res.json({ success: true, records_saved: savedCount, date: targetDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




