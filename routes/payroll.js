const express = require('express');
const router = express.Router();
const db = require('../db');

// Preview payroll calculation for an employee/month without saving
function computePayroll(employee_id, month, year) {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
  if (!emp) return null;

  const attRows = db.prepare(
    `SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ?`
  ).all(employee_id, `${year}-${String(month).padStart(2, '0')}-%`);

  const advRows = db.prepare(
    `SELECT * FROM advances WHERE employee_id = ? AND date LIKE ?`
  ).all(employee_id, `${year}-${String(month).padStart(2, '0')}-%`);

  const presentDays = attRows.filter(a => a.status === 'present').length
    + attRows.filter(a => a.status === 'half_day').length * 0.5;
  const leaveDays = attRows.filter(a => a.status === 'leave' || a.status === 'absent').length;

  const totalLateMinutes = attRows.reduce((s, a) => s + (a.late_minutes || 0), 0);
  const totalOvertimeMinutes = attRows.reduce((s, a) => s + (a.overtime_minutes || 0), 0);

  const perDaySalary = emp.salary_monthly / 30;
  const hourlyRate = perDaySalary / 8;

  const lateDeduction = Math.round((totalLateMinutes / 60) * hourlyRate);
  const overtimePay = Math.round((totalOvertimeMinutes / 60) * hourlyRate * 1.5);
  const advanceDeduction = advRows.reduce((s, a) => s + a.amount, 0);

  const netPay = Math.round(presentDays * perDaySalary + overtimePay - lateDeduction - advanceDeduction);

  return {
    employee_id,
    employee_name: emp.name,
    month,
    year,
    base_salary: emp.salary_monthly,
    present_days: presentDays,
    leave_days: leaveDays,
    late_deduction: lateDeduction,
    overtime_pay: overtimePay,
    advance_deduction: advanceDeduction,
    net_pay: netPay
  };
}

router.get('/preview', (req, res) => {
  const { employee_id, month, year } = req.query;
  const result = computePayroll(Number(employee_id), Number(month), Number(year));
  if (!result) return res.status(404).json({ error: 'Employee not found' });
  res.json(result);
});

router.post('/generate', (req, res) => {
  const { employee_id, month, year } = req.body;
  const calc = computePayroll(employee_id, month, year);
  if (!calc) return res.status(404).json({ error: 'Employee not found' });

  db.prepare(`
    INSERT INTO payroll (employee_id, month, year, base_salary, present_days, leave_days, late_deduction, overtime_pay, advance_deduction, net_pay, generated_at)
    VALUES (@employee_id, @month, @year, @base_salary, @present_days, @leave_days, @late_deduction, @overtime_pay, @advance_deduction, @net_pay, @generated_at)
    ON CONFLICT(employee_id, month, year) DO UPDATE SET
      base_salary=excluded.base_salary, present_days=excluded.present_days, leave_days=excluded.leave_days,
      late_deduction=excluded.late_deduction, overtime_pay=excluded.overtime_pay,
      advance_deduction=excluded.advance_deduction, net_pay=excluded.net_pay, generated_at=excluded.generated_at
  `).run({ ...calc, generated_at: new Date().toISOString() });

  res.json(db.prepare('SELECT * FROM payroll WHERE employee_id=? AND month=? AND year=?').get(employee_id, month, year));
});

router.get('/', (req, res) => {
  const { month, year } = req.query;
  const rows = db.prepare(
    `SELECT p.*, e.name as employee_name FROM payroll p JOIN employees e ON e.id = p.employee_id
     WHERE p.month = ? AND p.year = ? ORDER BY e.name`
  ).all(month, year);
  res.json(rows);
});

module.exports = router;
