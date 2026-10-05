const express = require('express');
const router = express.Router();
const db = require('../db');

// Search customers by name, phone, or vehicle registration number
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const searchPattern = `%${q}%`;
    const searchPhonePattern = `%${q.replace(/\D/g, '')}%`;

    // 1. Search customers table by name or phone
    const matchedCustomers = await db.prepare(
      'SELECT * FROM customers WHERE name LIKE ? OR (phone IS NOT NULL AND phone != \'\' AND phone LIKE ?)'
    ).all(searchPattern, searchPhonePattern.length > 2 ? searchPhonePattern : searchPattern);

    // Map customer IDs we already found
    const foundCustomerIds = new Set(matchedCustomers.map(c => c.id));
    const customerList = [...matchedCustomers];

    // 2. Search vehicles table by owner_name or reg_number
    const matchedVehicles = await db.prepare(
      'SELECT * FROM vehicles WHERE owner_name LIKE ? OR reg_number LIKE ?'
    ).all(searchPattern, searchPattern);

    // If any matched vehicle belongs to a customer not in foundCustomerIds, fetch/add customer
    for (const v of matchedVehicles) {
      if (v.customer_id && !foundCustomerIds.has(v.customer_id)) {
        const cust = await db.prepare('SELECT * FROM customers WHERE id = ?').get(v.customer_id);
        if (cust) {
          foundCustomerIds.add(cust.id);
          customerList.push(cust);
        }
      }
    }

    // 3. For each customer in list, fetch ALL their registered vehicles
    const results = await Promise.all(customerList.map(async (cust) => {
      let vehicles = await db.prepare(
        'SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id DESC'
      ).all(cust.id);

      // Fallback: match by owner_name if customer_id wasn't set on vehicle
      if (cust.name) {
        const ownerVehicles = await db.prepare(
          'SELECT * FROM vehicles WHERE (customer_id IS NULL OR customer_id = 0) AND owner_name = ?'
        ).all(cust.name);
        const existingVIds = new Set(vehicles.map(v => v.id));
        ownerVehicles.forEach(v => {
          if (!existingVIds.has(v.id)) vehicles.push(v);
        });
      }

      return {
        id: cust.id,
        name: cust.name || 'Customer',
        phone: cust.phone || '',
        reward_points: cust.reward_points || 0,
        vehicles
      };
    }));

    // If query matched vehicles whose owner has no customer row yet, add synthetic customer entry
    const claimedVehicleIds = new Set(results.flatMap(r => r.vehicles.map(v => v.id)));
    for (const v of matchedVehicles) {
      if (!claimedVehicleIds.has(v.id)) {
        results.push({
          id: null,
          name: v.owner_name || v.reg_number,
          phone: '',
          reward_points: 0,
          vehicles: [v]
        });
        claimedVehicleIds.add(v.id);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all customers
router.get('/', async (req, res) => {
  try {
    const customers = await db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new customer with multiple vehicles
router.post('/', async (req, res) => {
  try {
    const { name, phone, vehicles } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    let customer = null;
    if (phone && phone.trim()) {
      customer = await db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone.trim());
    }

    if (!customer) {
      const stmt = await db.prepare('INSERT INTO customers (name, phone, reward_points) VALUES (?, ?, ?)').run(
        name.trim(),
        phone ? phone.trim() : '',
        0
      );
      customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(stmt.lastInsertRowid);
    } else {
      await db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name.trim(), customer.id);
      customer.name = name.trim();
    }

    const createdVehicles = [];

    if (vehicles && Array.isArray(vehicles)) {
      for (const v of vehicles) {
        if (!v.reg_number || !v.reg_number.trim()) continue;
        const regUpper = v.reg_number.trim().toUpperCase();

        let existingVeh = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regUpper);
        if (existingVeh) {
          await db.prepare(`
            UPDATE vehicles SET customer_id = ?, brand = ?, model = ?, segment = ?, owner_name = ? WHERE id = ?
          `).run(
            customer.id,
            v.brand || existingVeh.brand || '',
            v.model || existingVeh.model || '',
            v.segment || existingVeh.segment || 'hatchback',
            customer.name,
            existingVeh.id
          );
          const updated = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(existingVeh.id);
          createdVehicles.push(updated);
        } else {
          const vStmt = await db.prepare(`
            INSERT INTO vehicles (reg_number, brand, model, segment, color, year, customer_id, owner_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            regUpper,
            v.brand || '',
            v.model || '',
            v.segment || 'hatchback',
            '',
            '',
            customer.id,
            customer.name
          );
          const newV = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vStmt.lastInsertRowid);
          createdVehicles.push(newV);
        }
      }
    }

    res.json({ ok: true, customer, vehicles: createdVehicles });
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add a vehicle to an existing customer
router.post('/:id/vehicles', async (req, res) => {
  try {
    const customerId = req.params.id;
    const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const { reg_number, brand, model, segment } = req.body;
    if (!reg_number || !reg_number.trim()) return res.status(400).json({ error: 'Vehicle registration number is required' });

    const regUpper = reg_number.trim().toUpperCase();

    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regUpper);
    if (vehicle) {
      await db.prepare(`
        UPDATE vehicles SET customer_id = ?, brand = ?, model = ?, segment = ?, owner_name = ? WHERE id = ?
      `).run(
        customerId,
        brand || vehicle.brand || '',
        model || vehicle.model || '',
        segment || vehicle.segment || 'hatchback',
        customer.name,
        vehicle.id
      );
      vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id);
    } else {
      const stmt = await db.prepare(`
        INSERT INTO vehicles (reg_number, brand, model, segment, customer_id, owner_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        regUpper,
        brand || '',
        model || '',
        segment || 'hatchback',
        customerId,
        customer.name
      );
      vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(stmt.lastInsertRowid);
    }

    res.json({ ok: true, vehicle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
