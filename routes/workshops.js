const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/workshops - List workshops
router.get('/', async (req, res) => {
  try {
    const { q, type } = req.query;
    let rows = await db.prepare('SELECT * FROM workshops ORDER BY id DESC').all();

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/workshops/:id - Get single workshop
router.get('/:id', async (req, res) => {
  try {
    const workshop = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
    if (!workshop) return res.status(404).json({ error: 'Workshop not found' });
    res.json(workshop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workshops - Create workshop
router.post('/', async (req, res) => {
  try {
    const { name, address, phone, owner_name, owner_phone, type } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workshop name is required' });
    }

    const createdAt = new Date().toISOString();
    const info = await db.prepare(`
      INSERT INTO workshops (name, address, phone, owner_name, owner_phone, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), address || null, phone || null, owner_name || null, owner_phone || null, type || 'Car Workshop', createdAt);

    const created = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(info.lastInsertRowid);
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/workshops/:id - Update workshop
router.put('/:id', async (req, res) => {
  try {
    const { name, address, phone, owner_name, owner_phone, type } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Workshop name is required' });
    }

    const existing = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Workshop not found' });

    await db.prepare(`
      UPDATE workshops
      SET name = ?, address = ?, phone = ?, owner_name = ?, owner_phone = ?, type = ?
      WHERE id = ?
    `).run(name.trim(), address || null, phone || null, owner_name || null, owner_phone || null, type || 'Car Workshop', req.params.id);

    const updated = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/workshops/:id - Delete workshop
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Workshop not found' });

    // Clean up pricing for this workshop
    await db.prepare('DELETE FROM workshop_pricing WHERE workshop_id = ?').run(req.params.id);
    
    // Set workshop_id to NULL on existing jobs for this workshop
    await db.prepare('UPDATE jobs SET workshop_id = NULL WHERE workshop_id = ?').run(req.params.id);

    await db.prepare('DELETE FROM workshops WHERE id = ?').run(req.params.id);
    res.json({ ok: true, message: 'Workshop deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
