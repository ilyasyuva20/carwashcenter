const express = require('express');
const router = express.Router();
const db = require('../db');
const { lookupVehicle } = require('../services/rtoLookup');

// Lookup (and cache) vehicle info by reg number
router.get('/lookup/:regNumber', async (req, res) => {
  try {
    const regNumber = req.params.regNumber.toUpperCase().replace(/\s+/g, '');
    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regNumber);

    // If vehicle exists in DB with valid brand or model, return it immediately
    if (vehicle && (vehicle.brand || vehicle.model)) {
      if (vehicle.customer_id) {
        const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
        if (customer && customer.phone) {
          vehicle.phone = customer.phone;
        }
      }
      return res.json(vehicle);
    }

    // Attempt live RTO lookup
    const info = await lookupVehicle(regNumber);

    if (info && !info.not_found && (info.brand || info.model)) {
      if (vehicle) {
        await db.prepare(
          'UPDATE vehicles SET brand = ?, model = ?, segment = ?, color = ? WHERE id = ?'
        ).run(info.brand, info.model, info.segment, info.color, vehicle.id);
        vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id);
      } else {
        const result = await db.prepare(
          'INSERT INTO vehicles (reg_number, brand, model, segment, color) VALUES (?, ?, ?, ?, ?)'
        ).run(regNumber, info.brand, info.model, info.segment, info.color);
        vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
      }
      vehicle.source = info.source;
      return res.json(vehicle);
    }

    // If lookup failed / rate-limited (manual-entry), DO NOT insert empty record into DB!
    const phone = vehicle?.customer_id ? (await db.prepare('SELECT phone FROM customers WHERE id = ?').get(vehicle.customer_id))?.phone : '';
    res.json({
      id: vehicle ? vehicle.id : null,
      reg_number: regNumber,
      brand: vehicle?.brand || '',
      model: vehicle?.model || '',
      segment: vehicle?.segment || 'hatchback',
      color: vehicle?.color || '',
      customer_id: vehicle?.customer_id || null,
      phone: phone || '',
      source: 'manual-entry',
      not_found: true
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manually correct a vehicle's details
router.put('/:id', async (req, res) => {
  try {
    const { brand, model, segment, color } = req.body;
    await db.prepare('UPDATE vehicles SET brand=?, model=?, segment=?, color=? WHERE id=?')
      .run(brand, model, segment, color, req.params.id);
    const updated = await db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM vehicles ORDER BY id DESC').all();
    res.json(rows);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
