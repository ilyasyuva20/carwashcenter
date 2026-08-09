const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

function nowISO() {
  return new Date().toISOString();
}

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeName = `before-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

router.post('/upload-before-photo', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'carwashapp-xwz9.onrender.com';
    const fullUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    res.json({ url: fullUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getJobFull(id) {
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return null;
  const vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(job.vehicle_id);
  if (vehicle && vehicle.customer_id) {
    const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
    if (customer && customer.phone) {
      vehicle.phone = customer.phone;
    }
    if (customer && customer.name && !job.customer_name) {
      job.customer_name = customer.name;
    }
  }

  let beforePhotosArr = [];
  if (job.before_photos) {
    try {
      const rawArr = typeof job.before_photos === 'string' ? JSON.parse(job.before_photos) : job.before_photos;
      if (Array.isArray(rawArr)) {
        beforePhotosArr = rawArr.map(url => {
          if (typeof url === 'string' && url.startsWith('/uploads/')) {
            return `https://carwashapp-xwz9.onrender.com${url}`;
          }
          return url;
        });
      }
    } catch(e) {
      beforePhotosArr = [];
    }
  }

  let washPrice = 0;
  const segment = vehicle ? vehicle.segment : '';

  if (job.customer_type === 'workshop') {
    // 1. Try specific workshop pricing
    let wpObj = null;
    const cleanWId = (job.workshop_id && job.workshop_id !== 'null' && !isNaN(Number(job.workshop_id))) ? Number(job.workshop_id) : null;
    if (cleanWId) {
      wpObj = await db.prepare('SELECT price FROM workshop_pricing WHERE workshop_id = ? AND wash_type_id = ? AND segment = ?')
        .get(cleanWId, job.wash_type_id, segment);
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
  const cleanWIdForSelect = (job.workshop_id && job.workshop_id !== 'null' && !isNaN(Number(job.workshop_id))) ? Number(job.workshop_id) : null;
  if (cleanWIdForSelect) {
    workshop = await db.prepare('SELECT * FROM workshops WHERE id = ?').get(cleanWIdForSelect);
  }

  const washType = await db.prepare('SELECT * FROM wash_types WHERE id = ?').get(job.wash_type_id);
  const bill = await db.prepare('SELECT * FROM bills WHERE job_id = ?').get(job.id);
  return {
    ...job,
    customer_name: job.customer_name || '',
    before_photos: beforePhotosArr,
    vehicle,
    wash_type: washType,
    price: totalPrice,
    wash_price: washPrice,
    chain_lube_price: lubePrice,
    workshop: workshop || null,
    bill: bill || null
  };
}

// Create a job. Body: { reg_number, wash_type_id, eta_minutes, phone, customer_name, before_photos, has_chain_lube, chain_lube_price, customer_type, workshop_id, payment_status }
router.post('/', async (req, res) => {
  try {
    const {
      reg_number,
      wash_type_id,
      eta_minutes,
      phone,
      customer_name,
      before_photos,
      has_chain_lube,
      chain_lube_price,
      customer_type,
      workshop_id,
      payment_status
    } = req.body;

    if (!reg_number) {
      return res.status(400).json({ error: 'Registration number is required' });
    }

    const cleanWashTypeId = (wash_type_id && wash_type_id !== 'null' && !isNaN(Number(wash_type_id)))
      ? Number(wash_type_id)
      : null;

    if (!cleanWashTypeId) {
      return res.status(400).json({ error: 'Please select a valid wash package' });
    }

    const REGEX_PLATE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
    const regNumber = reg_number.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!REGEX_PLATE.test(regNumber)) {
      return res.status(400).json({ error: 'Invalid registration number format (e.g. KL32L2011 or 22BH1234A)' });
    }
    let vehicle = await db.prepare('SELECT * FROM vehicles WHERE reg_number = ?').get(regNumber);
    if (!vehicle) {
      const result = await db.prepare(
        'INSERT INTO vehicles (reg_number, brand, model, segment, color) VALUES (?, ?, ?, ?, ?)'
      ).run(regNumber, '', '', 'hatchback', '');
      vehicle = await db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
    }

    const custName = customer_name ? customer_name.trim() : null;

    if (phone) {
      let customer = await db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (!customer) {
        const info = await db.prepare('INSERT INTO customers (phone, name) VALUES (?, ?)').run(phone, custName);
        customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
      } else if (custName) {
        await db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(custName, customer.id);
      }
      await db.prepare('UPDATE vehicles SET customer_id = ? WHERE id = ?').run(customer.id, vehicle.id);
    }

    const chainLube = has_chain_lube ? 1 : 0;
    const lubePrice = has_chain_lube ? (Number(chain_lube_price) || 150) : 0;
    const custType = customer_type === 'workshop' ? 'workshop' : 'normal';
    const wId = (custType === 'workshop' && workshop_id && workshop_id !== 'null' && !isNaN(Number(workshop_id)))
      ? Number(workshop_id)
      : null;
    const payStatus = payment_status === 'settled' ? 'settled' : 'unsettled';

    let photosJson = null;
    if (before_photos && Array.isArray(before_photos) && before_photos.length > 0) {
      photosJson = JSON.stringify(before_photos);
    }

    const info = await db.prepare(
      'INSERT INTO jobs (vehicle_id, wash_type_id, entry_time, eta_minutes, status, has_chain_lube, chain_lube_price, customer_type, workshop_id, payment_status, customer_name, before_photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(vehicle.id, cleanWashTypeId, nowISO(), Number(eta_minutes) || 30, 'in_progress', chainLube, lubePrice, custType, wId, payStatus, custName, photosJson);

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
