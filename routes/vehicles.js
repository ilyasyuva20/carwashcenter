const express = require('express');
const router = express.Router();
const db = require('../db');
const { lookupVehicle, normalizeCategory } = require('../services/rtoLookup');

const REGEX_PLATE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

// Lookup (and cache) vehicle info by reg number
router.get('/lookup/:regNumber', async (req, res) => {
  try {
    const regNumber = req.params.regNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!REGEX_PLATE.test(regNumber)) {
      return res.status(400).json({ error: 'Invalid registration number format (e.g. KL32L2011 or 22BH1234A)' });
    }
    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regNumber);

    // Use the cached vehicle when the core details are already complete.
    // Active jobs reference this same vehicle row, so they are cached too.
    if (vehicle && vehicle.brand && vehicle.model && vehicle.color && vehicle.owner_name) {
      const correctedSegment = vehicle.segment === 'hatchback'
        ? normalizeCategory('', vehicle.model, vehicle.brand)
        : vehicle.segment;
      if (correctedSegment !== vehicle.segment) {
        await db.prepare('UPDATE vehicles SET segment = ? WHERE id = ?').run(correctedSegment, vehicle.id);
        vehicle.segment = correctedSegment;
      }
      if (vehicle.customer_id) {
        const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
        if (customer) {
          if (customer.phone) vehicle.phone = customer.phone;
          if (customer.name) vehicle.customer_name = customer.name;
        }
      }
      if (!vehicle.customer_name && vehicle.owner_name) vehicle.customer_name = vehicle.owner_name;
      vehicle.source = 'database';
      return res.json(vehicle);
    }

    // Attempt live RTO lookup
    const info = await lookupVehicle(regNumber);

    if (info && !info.not_found && (info.brand || info.model)) {
      console.log(`[Vehicle Lookup Success]: Received live vehicle data via [${info.source}]`);
      console.log(`  ├─ Registration: ${info.reg_number}`);
      console.log(`  ├─ Brand: ${info.brand}`);
      console.log(`  ├─ Model: ${info.model}`);
      console.log(`  ├─ Color: ${info.color}`);
      console.log(`  ├─ Year: ${info.year}`);
      console.log(`  └─ Segment: ${info.segment}`);

      if (vehicle) {
        await db.prepare(
          'UPDATE vehicles SET brand = ?, model = ?, segment = ?, color = ?, year = ?, owner_name = ? WHERE id = ?'
        ).run(info.brand, info.model, info.segment, info.color, info.year || '', info.owner_name || '', vehicle.id);
        vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id);
        console.log(`[Database Update]: Updated vehicle ID ${vehicle.id} with new details.`);
      } else {
        const result = await db.prepare(
          'INSERT INTO vehicles (reg_number, brand, model, segment, color, year, owner_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(regNumber, info.brand, info.model, info.segment, info.color, info.year || '', info.owner_name || '');
        vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
        console.log(`[Database Insert]: Saved new vehicle ID ${vehicle.id} to database.`);
      }
      vehicle.customer_name = vehicle.owner_name || '';
      vehicle.source = info.source;
      return res.json(vehicle);
    }

    // Keep existing vehicle details when the provider is temporarily unavailable.
    if (vehicle && vehicle.brand && vehicle.model && vehicle.color) {
      const phone = vehicle.customer_id
        ? (await db.prepare('SELECT phone FROM customers WHERE id = ?').get(vehicle.customer_id))?.phone
        : '';
      vehicle.customer_name = vehicle.customer_name || vehicle.owner_name || '';
      vehicle.phone = phone || '';
      vehicle.source = 'database';
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
      year: vehicle?.year || '',
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
    const rawId = req.params.id;
    if (!rawId || rawId === 'null' || rawId === 'undefined') {
      return res.json({ message: 'No valid vehicle ID provided' });
    }
    const vehicleId = parseInt(rawId);
    if (isNaN(vehicleId)) {
      return res.json({ message: 'Invalid vehicle ID' });
    }
    const { brand, model, segment, color, year } = req.body;
    await db.prepare('UPDATE vehicles SET brand=?, model=?, segment=?, color=?, year=? WHERE id=?')
      .run(brand, model, segment, color, year || '', vehicleId);
    const updated = await db.prepare('SELECT * FROM vehicles WHERE id=?').get(vehicleId);
    res.json(updated || { id: vehicleId, brand, model, segment, color, year });
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
