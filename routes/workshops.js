const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/workshops - List workshops
router.get('/', (req, res) => {
  const { q, type } = req.query;
  let rows = db.prepare('SELECT * FROM workshops ORDER BY id DESC').all();

  if (q) {
    const search = q.toLowerCase();
    rows = rows.filter(w =>
      (w.name || '').toLowerCase().includes(search) ||
      (w.phone || '').toLowerCase().includes(search) ||
      (w.owner_name || '').toLowerCase().includes(search) ||
      (w.owner_phone || '').toLowerCase().includes(search) ||
      (w.address || '').toLowerCase().includes(search)
    );
  }

  if (type && type !== 'all') {
    rows = rows.filter(w => w.type === type);
  }

  res.json(rows);
});

// GET /api/workshops/:id - Get single workshop
router.get('/:id', (req, res) => {
  const workshop = db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
  if (!workshop) return res.status(404).json({ error: 'Workshop not found' });
  res.json(workshop);
});

// POST /api/workshops - Create workshop
router.post('/', (req, res) => {
  const { name, address, phone, owner_name, owner_phone, type } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Workshop name is required' });
  }

  const createdAt = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO workshops (name, address, phone, owner_name, owner_phone, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), address || null, phone || null, owner_name || null, owner_phone || null, type || 'Car Workshop', createdAt);

  const created = db.prepare('SELECT * FROM workshops WHERE id = ?').get(info.lastInsertRowid);
  res.json(created);
});

// PUT /api/workshops/:id - Update workshop
router.put('/:id', (req, res) => {
  const { name, address, phone, owner_name, owner_phone, type } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Workshop name is required' });
  }

  const existing = db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Workshop not found' });

  db.prepare(`
    UPDATE workshops
    SET name = ?, address = ?, phone = ?, owner_name = ?, owner_phone = ?, type = ?
    WHERE id = ?
  `).run(name.trim(), address || null, phone || null, owner_name || null, owner_phone || null, type || 'Car Workshop', req.params.id);

  const updated = db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/workshops/:id - Delete workshop
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Workshop not found' });

  // Clean up pricing for this workshop
  db.prepare('DELETE FROM workshop_pricing WHERE workshop_id = ?').run(req.params.id);
  
  // Set workshop_id to NULL on existing jobs for this workshop
  db.prepare('UPDATE jobs SET workshop_id = NULL WHERE workshop_id = ?').run(req.params.id);

  db.prepare('DELETE FROM workshops WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Workshop deleted successfully' });
});

module.exports = router;
