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

module.exports = router;
