const express = require('express');
const router = express.Router();
const db = require('../db');

function nowISO() {
  return new Date().toISOString();
}

async function getJobFull(id) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return null;
  const vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(job.vehicle_id);
  if (vehicle && vehicle.customer_id) {
    const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
    if (customer && customer.phone) {
      vehicle.phone = customer.phone;
    }
  }
  let washPrice = 0;
  const segment = vehicle ? vehicle.segment : '';

  if (job.customer_type === 'workshop') {
    // 1. Try specific workshop pricing
    let wpObj = null;
    if (job.workshop_id) {
      wpObj = await db.prepare('SELECT price FROM workshop_pricing WHERE workshop_id = ? AND wash_type_id = ? AND segment = ?')
        .get(job.workshop_id, job.wash_type_id, segment);
    }
    // 2. Try default workshop pricing
    if (!wpObj) {
      wpObj = await db.prepare('SELECT price FROM workshop_pricing WHERE workshop_id IS NULL AND wash_type_id = ? AND segment = ?')
        .get(job.wash_type_id, segment);
    }
    // 3. Fallback to normal pricing
    if (!wpObj) {
      wpObj = await db.prepare('SELECT price FROM pricing WHERE wash_type_id = ? AND segment = ?')
        .get(job.wash_type_id, segment);
    }
    washPrice = wpObj ? Number(wpObj.price) : (segment === 'scooter' ? 250 : (segment === 'bike' ? 250 : 0));
  } else {
    // Normal Customer Pricing
    const basePriceObj = await db.prepare('SELECT price FROM pricing WHERE wash_type_id = ? AND segment = ?')
      .get(job.wash_type_id, segment);
    washPrice = basePriceObj ? Number(basePriceObj.price) : (segment === 'scooter' ? 250 : (segment === 'bike' ? 250 : 0));
  }

  const lubePrice = job.has_chain_lube ? (Number(job.chain_lube_price) || 150) : 0;
  const totalPrice = washPrice + lubePrice;

  let workshop = null;
  if (job.workshop_id) {
    workshop = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(job.workshop_id);
  }

  const washType = await db.prepare('SELECT * FROM wash_types WHERE id = ?').get(job.wash_type_id);
  const bill = await db.prepare('SELECT * FROM bills WHERE job_id = ?').get(job.id);
  return {
    ...job,
    vehicle,
    wash_type: washType,
    price: totalPrice,
    wash_price: washPrice,
    chain_lube_price: lubePrice,
    workshop: workshop || null,
    bill: bill || null
  };
}

// Create a job. Body: { reg_number, wash_type_id, eta_minutes, phone, has_chain_lube, chain_lube_price, customer_type, workshop_id, payment_status }
router.post('/', async (req, res) => {
  try {
    const {
      reg_number,
      wash_type_id,
      eta_minutes,
      phone,
      has_chain_lube,
      chain_lube_price,
      customer_type,
      workshop_id,
      payment_status
    } = req.body;

    const regNumber = reg_number.toUpperCase().replace(/\s+/g, '');
    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regNumber);
    if (!vehicle) {
      const result = await db.prepare(
        'INSERT INTO vehicles (reg_number, brand, model, segment, color) VALUES (?, ?, ?, ?, ?)'
      ).run(regNumber, '', '', 'hatchback', '');
      vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
    }

    if (phone) {
      let customer = await db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (!customer) {
        const info = await db.prepare('INSERT INTO customers (phone) VALUES (?)').run(phone);
        customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
      }
      await db.prepare('UPDATE vehicles SET customer_id = ? WHERE id = ?').run(customer.id, vehicle.id);
    }

    const chainLube = has_chain_lube ? 1 : 0;
    const lubePrice = has_chain_lube ? (chain_lube_price || 150) : 0;
    const custType = customer_type === 'workshop' ? 'workshop' : 'normal';
    const wId = custType === 'workshop' && workshop_id ? Number(workshop_id) : null;
    const payStatus = payment_status === 'settled' ? 'settled' : 'unsettled';

    const info = await db.prepare(
      'INSERT INTO jobs (vehicle_id, wash_type_id, entry_time, eta_minutes, status, has_chain_lube, chain_lube_price, customer_type, workshop_id, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(vehicle.id, wash_type_id, nowISO(), eta_minutes || 30, 'in_progress', chainLube, lubePrice, custType, wId, payStatus);

    const fullJob = await getJobFull(info.lastInsertRowid);
    res.json(fullJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, date, payment_status, customer_type } = req.query;
    let jobs = await db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
    if (status) jobs = jobs.filter(j => j.status === status);
    if (payment_status) jobs = jobs.filter(j => j.payment_status === payment_status);
    if (customer_type) jobs = jobs.filter(j => j.customer_type === customer_type);
    if (date) jobs = jobs.filter(j => j.entry_time && j.entry_time.startsWith(date));
    
    const fullJobs = await Promise.all(jobs.map(j => getJobFull(j.id)));
    res.json(fullJobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await getJobFull(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// General update endpoint for status, payment_status, workshop_id, etc.
router.put('/:id', async (req, res) => {
  try {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });

    const { status, payment_status, customer_type, workshop_id } = req.body;

    let newStatus = job.status;
    let exitTime = job.exit_time;
    if (status) {
      newStatus = status;
      if (status === 'completed' && !job.exit_time) {
        exitTime = nowISO();
      }
    }

    let newPayStatus = job.payment_status || 'unsettled';
    if (payment_status) {
      newPayStatus = payment_status;
    }

    let newCustType = job.customer_type || 'normal';
    if (customer_type) {
      newCustType = customer_type;
    }

    let newWId = job.workshop_id;
    if (workshop_id !== undefined) {
      newWId = workshop_id ? Number(workshop_id) : null;
    }

    await db.prepare(
      'UPDATE jobs SET status = ?, exit_time = ?, payment_status = ?, customer_type = ?, workshop_id = ? WHERE id = ?'
    ).run(newStatus, exitTime, newPayStatus, newCustType, newWId, job.id);

    const fullJob = await getJobFull(job.id);
    res.json(fullJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark job completed (sets exit_time)
router.post('/:id/complete', async (req, res) => {
  try {
    const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    await db.prepare('UPDATE jobs SET status=?, exit_time=? WHERE id=?').run('completed', nowISO(), job.id);
    const fullJob = await getJobFull(job.id);
    res.json(fullJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    await db.prepare('UPDATE jobs SET status=? WHERE id=?').run('cancelled', req.params.id);
    const fullJob = await getJobFull(req.params.id);
    res.json(fullJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getJobFull = getJobFull;
