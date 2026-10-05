const express = require('express');
const router = express.Router();
const db = require('../db');

// List all subscriptions with customer & linked vehicles details
router.get('/', async (req, res) => {
  try {
    const subscriptions = await db.prepare("SELECT * FROM subscriptions ORDER BY id DESC").all();
    const today = new Date().toISOString().slice(0, 10);
    const result = [];

    for (const sub of subscriptions) {
      const customer = (await db.prepare("SELECT id, name, phone FROM customers WHERE id = ?").get(sub.customer_id)) || { name: 'Customer', phone: '' };

      const subVehicles = await db.prepare(`
        SELECT v.id, v.reg_number, v.brand, v.model, v.segment
        FROM subscription_vehicles sv
        JOIN vehicles v ON v.id = sv.vehicle_id
        WHERE sv.subscription_id = ?
      `).all(sub.id);

      const washLogs = await db.prepare(`
        SELECT sw.*, v.reg_number
        FROM subscription_washes sw
        LEFT JOIN vehicles v ON v.id = sw.vehicle_id
        WHERE sw.subscription_id = ?
        ORDER BY sw.id DESC
      `).all(sub.id);

      // Compute dynamic status
      let computedStatus = sub.status || 'active';
      if (computedStatus !== 'cancelled') {
        if (today > sub.end_date) {
          computedStatus = 'expired';
        } else {
          const diffMs = new Date(sub.end_date) - new Date(today);
          const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (daysLeft <= 5) {
            computedStatus = 'expiring_soon';
          } else {
            computedStatus = 'active';
          }
        }
      }

      result.push({
        ...sub,
        computed_status: computedStatus,
        customer,
        vehicles: subVehicles,
        wash_logs: washLogs
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create new monthly package subscription
router.post('/', async (req, res) => {
  try {
    const {
      customer_id,
      vehicle_ids,
      plan_name,
      price,
      start_date,
      end_date,
      max_washes,
      payment_method,
      notes
    } = req.body;

    if (!customer_id) return res.status(400).json({ error: 'Customer selection is required' });
    if (!vehicle_ids || !Array.isArray(vehicle_ids) || vehicle_ids.length === 0) {
      return res.status(400).json({ error: 'At least one vehicle must be selected for the subscription' });
    }

    const startDate = start_date || new Date().toISOString().slice(0, 10);
    let endDate = end_date;
    if (!endDate) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + 1);
      endDate = d.toISOString().slice(0, 10);
    }

    const createdAt = new Date().toISOString();

    const stmt = await db.prepare(`
      INSERT INTO subscriptions (
        customer_id, plan_name, price, start_date, end_date, max_washes, washes_used, status, payment_method, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customer_id,
      plan_name || 'Monthly Wash Package',
      Number(price) || 0,
      startDate,
      endDate,
      max_washes !== undefined ? Number(max_washes) : -1,
      0,
      'active',
      payment_method || 'cash',
      notes || '',
      createdAt
    );

    const subscriptionId = stmt.lastInsertRowid;

    for (const vId of vehicle_ids) {
      await db.prepare(`
        INSERT INTO subscription_vehicles (subscription_id, vehicle_id) VALUES (?, ?)
      `).run(subscriptionId, vId);
    }

    res.json({ ok: true, id: subscriptionId });
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check if a vehicle has an active subscription
router.get('/check-vehicle/:vehicleId', async (req, res) => {
  try {
    const vehicleId = req.params.vehicleId;
    const today = new Date().toISOString().slice(0, 10);

    const subVehicles = await db.prepare(`
      SELECT sv.subscription_id
      FROM subscription_vehicles sv
      JOIN subscriptions s ON s.id = sv.subscription_id
      WHERE sv.vehicle_id = ? AND s.status != 'cancelled' AND s.start_date <= ? AND s.end_date >= ?
    `).all(vehicleId, today, today);

    if (subVehicles.length > 0) {
      const sub = await db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subVehicles[0].subscription_id);
      return res.json({ active: true, subscription: sub });
    }

    res.json({ active: false, subscription: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Renew subscription
router.post('/:id/renew', async (req, res) => {
  try {
    const subId = req.params.id;
    const sub = await db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const { price, payment_method } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    let newStartDate = today;
    if (sub.end_date && sub.end_date > today) {
      newStartDate = sub.end_date;
    }

    const d = new Date(newStartDate);
    d.setMonth(d.getMonth() + 1);
    const newEndDate = d.toISOString().slice(0, 10);

    await db.prepare(`
      UPDATE subscriptions SET
        price = ?,
        start_date = ?,
        end_date = ?,
        washes_used = 0,
        status = 'active',
        payment_method = ?
      WHERE id = ?
    `).run(
      price !== undefined ? Number(price) : sub.price,
      newStartDate,
      newEndDate,
      payment_method || sub.payment_method || 'cash',
      subId
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit subscription
router.put('/:id', async (req, res) => {
  try {
    const {
      plan_name,
      price,
      start_date,
      end_date,
      max_washes,
      status,
      notes,
      vehicle_ids
    } = req.body;

    await db.prepare(`
      UPDATE subscriptions SET
        plan_name = ?, price = ?, start_date = ?, end_date = ?, max_washes = ?, status = ?, notes = ?
      WHERE id = ?
    `).run(
      plan_name,
      Number(price) || 0,
      start_date,
      end_date,
      Number(max_washes),
      status,
      notes || '',
      req.params.id
    );

    if (vehicle_ids && Array.isArray(vehicle_ids)) {
      await db.prepare("DELETE FROM subscription_vehicles WHERE subscription_id = ?").run(req.params.id);
      for (const vId of vehicle_ids) {
        await db.prepare("INSERT INTO subscription_vehicles (subscription_id, vehicle_id) VALUES (?, ?)").run(req.params.id, vId);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete / Cancel subscription
router.delete('/:id', async (req, res) => {
  try {
    await db.prepare("DELETE FROM subscriptions WHERE id = ?").run(req.params.id);
    await db.prepare("DELETE FROM subscription_vehicles WHERE subscription_id = ?").run(req.params.id);
    await db.prepare("DELETE FROM subscription_washes WHERE subscription_id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
