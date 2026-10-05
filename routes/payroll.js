const express = require('express');
const router = express.Router();
const db = require('../db');

// Preview payroll calculation for an employee/month without saving
async function computePayroll(employee_id, month, year) {
  const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!emp) return null;

  const monthStr = String(month).padStart(2, '0');
  const monthPattern = `${year}-${monthStr}-%`;

  const attRows = await db.prepare(
    `SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ?`
  ).all(employee_id, monthPattern);

  const advRows = await db.prepare(
    `SELECT * FROM advances WHERE employee_id = ? AND date LIKE ?`
  ).all(employee_id, monthPattern);

  const baseSalary = Number(emp.salary_monthly) || 0;
  const perDaySalary = baseSalary / 30; // ₹600/day for ₹18,000 monthly
  const hourlyRate = perDaySalary / 8; // 8 hours duty -> ₹75/hour
  const perMinuteRate = hourlyRate / 60; // ₹1.25/minute

  const fullDaysAbsent = attRows.filter(a => a.status === 'leave' || a.status === 'absent').length;
  const halfDaysCount = attRows.filter(a => a.status === 'half_day').length;

  const fullDayLeaveDeduction = fullDaysAbsent * perDaySalary;
  const halfDayLeaveDeduction = halfDaysCount * (perDaySalary / 2);
  const totalLeaveDeduction = fullDayLeaveDeduction + halfDayLeaveDeduction;

  const totalLateMinutes = attRows.reduce((s, a) => s + (Number(a.late_minutes) || 0), 0);
  const lateDeduction = Math.round(totalLateMinutes * perMinuteRate);

  const totalOvertimeMinutes = attRows.reduce((s, a) => s + (Number(a.overtime_minutes) || 0), 0);
  const overtimePay = Math.round((totalOvertimeMinutes / 60) * hourlyRate * 1.5);

  const advanceDeduction = advRows.reduce((s, a) => s + (Number(a.amount) || 0), 0);

  const netPay = Math.max(0, Math.round(baseSalary - totalLeaveDeduction - lateDeduction + overtimePay - advanceDeduction));

  const presentDays = attRows.filter(a => a.status === 'present').length + (halfDaysCount * 0.5);

  return {
    employee_id,
    employee_name: emp.name,
    month,
    year,
    base_salary: baseSalary,
    per_day_salary: Math.round(perDaySalary * 100) / 100,
    hourly_rate: Math.round(hourlyRate * 100) / 100,
    present_days: presentDays,
    leave_days: fullDaysAbsent,
    half_days: halfDaysCount,
    leave_deduction: Math.round(totalLeaveDeduction),
    total_late_minutes: totalLateMinutes,
    late_deduction: lateDeduction,
    total_overtime_minutes: totalOvertimeMinutes,
    overtime_pay: overtimePay,
    advance_deduction: advanceDeduction,
    net_pay: netPay
  };
}

router.get('/preview', async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    const result = await computePayroll(Number(employee_id), Number(month), Number(year));
    if (!result) return res.status(404).json({ error: 'Employee not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { employee_id, month, year } = req.body;
    const calc = await computePayroll(employee_id, month, year);
    if (!calc) return res.status(404).json({ error: 'Employee not found' });

    const existing = await db.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? AND year=?').get(employee_id, month, year);
    const now = new Date().toISOString();

    if (existing) {
      await db.prepare(`
        UPDATE payroll SET base_salary=?, present_days=?, leave_days=?, late_deduction=?, overtime_pay=?, advance_deduction=?, net_pay=?, generated_at=?
        WHERE id=?
      `).run(calc.base_salary, calc.present_days, calc.leave_days, calc.late_deduction, calc.overtime_pay, calc.advance_deduction, calc.net_pay, now, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO payroll (employee_id, month, year, base_salary, present_days, leave_days, late_deduction, overtime_pay, advance_deduction, net_pay, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(employee_id, month, year, calc.base_salary, calc.present_days, calc.leave_days, calc.late_deduction, calc.overtime_pay, calc.advance_deduction, calc.net_pay, now);
    }

    const row = await db.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? AND year=?').get(employee_id, month, year);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query;
    const rows = await db.prepare(
      `SELECT p.*, e.name as employee_name FROM payroll p JOIN employees e ON e.id = p.employee_id
       WHERE p.month = ? AND p.year = ? ORDER BY e.name`
    ).all(month, year);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
