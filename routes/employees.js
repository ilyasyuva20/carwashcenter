const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(emp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post with optional aadhaar_file upload
router.post('/', upload.single('aadhaar_file'), async (req, res) => {
  try {
    const { name, phone, role, salary_monthly, join_date, branch_id, aadhaar_number } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Employee name is required' });
    }

    const aadhaar_file = req.file ? `/uploads/${req.file.filename}` : (req.body.aadhaar_file || null);

    const info = await db.prepare(
      'INSERT INTO employees (name, phone, role, salary_monthly, join_date, branch_id, aadhaar_number, aadhaar_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name.trim(),
      phone || null,
      role || null,
      Number(salary_monthly) || 0,
      join_date || null,
      Number(branch_id) || 1,
      aadhaar_number || null,
      aadhaar_file
    );
    
    const created = await db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
    res.json(created);
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', upload.single('aadhaar_file'), async (req, res) => {
  try {
    const { name, phone, role, salary_monthly, join_date, aadhaar_number } = req.body;
    const existing = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    const aadhaar_file = req.file ? `/uploads/${req.file.filename}` : existing.aadhaar_file;

    await db.prepare(
      'UPDATE employees SET name=?, phone=?, role=?, salary_monthly=?, join_date=?, aadhaar_number=?, aadhaar_file=? WHERE id=?'
    ).run(
      name || existing.name,
      phone !== undefined ? phone : existing.phone,
      role || existing.role,
      salary_monthly !== undefined ? Number(salary_monthly) : existing.salary_monthly,
      join_date || existing.join_date,
      aadhaar_number !== undefined ? aadhaar_number : existing.aadhaar_number,
      aadhaar_file,
      req.params.id
    );
    
    const updated = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download endpoint for Aadhaar card
router.get('/:id/download-aadhaar', async (req, res) => {
  try {
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp || !emp.aadhaar_file) {
      return res.status(404).send('Aadhaar document not found');
    }

    const filename = path.basename(emp.aadhaar_file);
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found on server');
    }

    const downloadName = `Aadhaar_${emp.name.replace(/\s+/g, '_')}${path.extname(filename)}`;
    res.download(filePath, downloadName);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Advance payment
router.post('/:id/advance', async (req, res) => {
  try {
    const { amount, date, payment_method, note } = req.body;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const datePart = date || now.toISOString().slice(0, 10);
    const fullTimestamp = `${datePart} ${timeStr}`;

    const info = await db.prepare(
      'INSERT INTO advances (employee_id, date, amount, payment_method, note) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.id, fullTimestamp, amount, payment_method || 'cash', note || null);

    const advance = await db.prepare('SELECT * FROM advances WHERE id = ?').get(info.lastInsertRowid);
    res.json(advance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/advances', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM advances WHERE employee_id = ? ORDER BY date DESC').all(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
