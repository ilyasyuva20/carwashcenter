const express = require('express');
const router = express.Router();
const db = require('../db');

// Search customers by name, phone, vehicle registration number, or monthly subscription
router.get('/search', async (req, res) => {
  try {
    const rawQ = (req.query.q || '').trim();
    if (!rawQ) return res.json([]);

    const today = new Date().toISOString().slice(0, 10);

    // Normalized search patterns (strip spaces and special characters for flexible plate matching)
    const cleanReg = rawQ.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const searchPattern = `%${rawQ}%`;
    const cleanRegPattern = `%${cleanReg}%`;
    const phoneDigits = rawQ.replace(/\D/g, '');
    const phonePattern = phoneDigits.length >= 3 ? `%${phoneDigits}%` : searchPattern;

    // 1. Search customers table by name or phone (case-insensitive & space-insensitive)
    const matchedCustomers = await db.prepare(`
      SELECT * FROM customers 
      WHERE LOWER(name) LIKE LOWER(?) 
         OR (phone IS NOT NULL AND phone != '' AND REPLACE(REPLACE(phone, ' ', ''), '-', '') LIKE ?)
    `).all(searchPattern, phonePattern);

    const foundCustomerIds = new Set(matchedCustomers.map(c => c.id));
    const customerList = [...matchedCustomers];

    // 2. Search vehicles table by owner_name or reg_number (flexible case & space matching)
    const matchedVehicles = await db.prepare(`
      SELECT * FROM vehicles 
      WHERE LOWER(owner_name) LIKE LOWER(?) 
         OR LOWER(reg_number) LIKE LOWER(?) 
         OR (${cleanReg.length >= 3 ? "REPLACE(REPLACE(REPLACE(LOWER(reg_number), ' ', ''), '-', ''), '.', '') LIKE LOWER(?)" : "0"})
    `).all(
      searchPattern,
      searchPattern,
      ...(cleanReg.length >= 3 ? [cleanRegPattern] : [])
    );

    // Add customers for matched vehicles if not already included
    for (const v of matchedVehicles) {
      if (v.customer_id && !foundCustomerIds.has(v.customer_id)) {
        const cust = await db.prepare('SELECT * FROM customers WHERE id = ?').get(v.customer_id);
        if (cust) {
          foundCustomerIds.add(cust.id);
          customerList.push(cust);
        }
      }
    }

    // 3. Search subscriptions table (by plan_name, customer_id, or linked vehicles)
    const matchedSubscriptions = await db.prepare(`
      SELECT s.*, c.name as customer_name, c.phone as customer_phone
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE LOWER(c.name) LIKE LOWER(?) 
         OR (c.phone IS NOT NULL AND REPLACE(REPLACE(c.phone, ' ', ''), '-', '') LIKE ?)
         OR LOWER(s.plan_name) LIKE LOWER(?)
    `).all(searchPattern, phonePattern, searchPattern);

    for (const sub of matchedSubscriptions) {
      if (sub.customer_id && !foundCustomerIds.has(sub.customer_id)) {
        const cust = await db.prepare('SELECT * FROM customers WHERE id = ?').get(sub.customer_id);
        if (cust) {
          foundCustomerIds.add(cust.id);
          customerList.push(cust);
        }
      }
    }

    // 4. For each customer in list, fetch ALL registered vehicles and check active subscriptions
    const results = await Promise.all(customerList.map(async (cust) => {
      let vehicles = await db.prepare(
        'SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id DESC'
      ).all(cust.id);

      // Fallback: match by owner_name if customer_id wasn't set on vehicle
      if (cust.name) {
        const ownerVehicles = await db.prepare(
          'SELECT * FROM vehicles WHERE (customer_id IS NULL OR customer_id = 0) AND LOWER(owner_name) = LOWER(?)'
        ).all(cust.name);
        const existingVIds = new Set(vehicles.map(v => v.id));
        ownerVehicles.forEach(v => {
          if (!existingVIds.has(v.id)) vehicles.push(v);
        });
      }

      // Check active monthly subscriptions for this customer
      const activeSubs = await db.prepare(`
        SELECT * FROM subscriptions 
        WHERE customer_id = ? AND status != 'cancelled' AND start_date <= ? AND end_date >= ?
      `).all(cust.id, today, today);

      const primarySub = activeSubs[0] || null;

      // Attach active subscription data to each vehicle if linked
      const vehiclesWithSub = await Promise.all(vehicles.map(async (v) => {
        const vSub = await db.prepare(`
          SELECT s.* FROM subscription_vehicles sv
          JOIN subscriptions s ON s.id = sv.subscription_id
          WHERE sv.vehicle_id = ? AND s.status != 'cancelled' AND s.start_date <= ? AND s.end_date >= ?
        `).get(v.id, today, today);

        return {
          ...v,
          subscription: vSub || primarySub || null
        };
      }));

      const hasActiveSub = activeSubs.length > 0 || vehiclesWithSub.some(v => v.subscription);

      return {
        id: cust.id,
        name: cust.name || 'Customer',
        phone: cust.phone || '',
        reward_points: cust.reward_points || 0,
        has_active_subscription: hasActiveSub,
        active_subscription: primarySub ? {
          id: primarySub.id,
          plan_name: primarySub.plan_name,
          end_date: primarySub.end_date,
          washes_used: primarySub.washes_used,
          max_washes: primarySub.max_washes
        } : (vehiclesWithSub.find(v => v.subscription)?.subscription ? {
          id: vehiclesWithSub.find(v => v.subscription).subscription.id,
          plan_name: vehiclesWithSub.find(v => v.subscription).subscription.plan_name,
          end_date: vehiclesWithSub.find(v => v.subscription).subscription.end_date,
          washes_used: vehiclesWithSub.find(v => v.subscription).subscription.washes_used,
          max_washes: vehiclesWithSub.find(v => v.subscription).subscription.max_washes
        } : null),
        vehicles: vehiclesWithSub
      };
    }));

    // Add entries for vehicles matched without customer record
    const claimedVehicleIds = new Set(results.flatMap(r => r.vehicles.map(v => v.id)));
    for (const v of matchedVehicles) {
      if (!claimedVehicleIds.has(v.id)) {
        const vSub = await db.prepare(`
          SELECT s.* FROM subscription_vehicles sv
          JOIN subscriptions s ON s.id = sv.subscription_id
          WHERE sv.vehicle_id = ? AND s.status != 'cancelled' AND s.start_date <= ? AND s.end_date >= ?
        `).get(v.id, today, today);

        results.push({
          id: null,
          name: v.owner_name || v.reg_number,
          phone: '',
          reward_points: 0,
          has_active_subscription: !!vSub,
          active_subscription: vSub ? {
            id: vSub.id,
            plan_name: vSub.plan_name,
            end_date: vSub.end_date,
            washes_used: vSub.washes_used,
            max_washes: vSub.max_washes
          } : null,
          vehicles: [{ ...v, subscription: vSub || null }]
        });
        claimedVehicleIds.add(v.id);
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Error searching customers:', err);
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
            UPDATE vehicles SET customer_id = ?, brand = ?, model = ?, segment = ?, color = ?, owner_name = ? WHERE id = ?
          `).run(
            customer.id,
            v.brand || existingVeh.brand || '',
            v.model || existingVeh.model || '',
            v.segment || existingVeh.segment || 'hatchback',
            v.color || existingVeh.color || '',
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
            v.color || '',
            v.year || '',
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

    const { reg_number, brand, model, segment, color } = req.body;
    if (!reg_number || !reg_number.trim()) return res.status(400).json({ error: 'Vehicle registration number is required' });

    const regUpper = reg_number.trim().toUpperCase();

    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regUpper);
    if (vehicle) {
      await db.prepare(`
        UPDATE vehicles SET customer_id = ?, brand = ?, model = ?, segment = ?, color = ?, owner_name = ? WHERE id = ?
      `).run(
        customerId,
        brand || vehicle.brand || '',
        model || vehicle.model || '',
        segment || vehicle.segment || 'hatchback',
        color || vehicle.color || '',
        customer.name,
        vehicle.id
      );
      vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle.id);
    } else {
      const stmt = await db.prepare(`
        INSERT INTO vehicles (reg_number, brand, model, segment, color, customer_id, owner_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        regUpper,
        brand || '',
        model || '',
        segment || 'hatchback',
        color || '',
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
