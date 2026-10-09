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

async function getJobsFullBatch(jobsOrIds) {
  if (!jobsOrIds || !Array.isArray(jobsOrIds) || jobsOrIds.length === 0) {
    return [];
  }

  let rawJobs = [];
  const sample = jobsOrIds[0];
  if (typeof sample === 'object' && sample !== null && sample.id) {
    rawJobs = jobsOrIds;
  } else {
    const ids = jobsOrIds.map(Number).filter(n => Number.isInteger(n));
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    rawJobs = await db.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders}) ORDER BY id DESC`).all(...ids);
  }

  if (rawJobs.length === 0) return [];

  const vehicleIds = [...new Set(rawJobs.map(j => j.vehicle_id).filter(Boolean))];
  const workshopIds = [...new Set(rawJobs.map(j => j.workshop_id).filter(id => id && id !== 'null' && !isNaN(Number(id))).map(Number))];
  const jobIds = rawJobs.map(j => j.id);

  const vehiclesPromise = vehicleIds.length > 0
    ? db.prepare(`SELECT * FROM vehicles WHERE id IN (${vehicleIds.map(() => '?').join(',')})`).all(...vehicleIds)
    : Promise.resolve([]);

  const washTypesPromise = db.prepare('SELECT * FROM wash_types').all();
  const workshopsPromise = db.prepare('SELECT * FROM workshops').all();
  const pricingPromise = db.prepare('SELECT * FROM pricing').all();
  const workshopPricingPromise = db.prepare('SELECT * FROM workshop_pricing').all();
  const billsPromise = jobIds.length > 0
    ? db.prepare(`SELECT * FROM bills WHERE job_id IN (${jobIds.map(() => '?').join(',')})`).all(...jobIds)
    : Promise.resolve([]);

  const [
    vehiclesList,
    washTypesList,
    workshopsList,
    pricingList,
    workshopPricingList,
    billsList
  ] = await Promise.all([
    vehiclesPromise,
    washTypesPromise,
    workshopsPromise,
    pricingPromise,
    workshopPricingPromise,
    billsPromise
  ]);

  const customerIds = [...new Set(vehiclesList.map(v => v.customer_id).filter(Boolean))];
  const customersList = customerIds.length > 0
    ? await db.prepare(`SELECT * FROM customers WHERE id IN (${customerIds.map(() => '?').join(',')})`).all(...customerIds)
    : [];

  const vehicleMap = new Map(vehiclesList.map(v => [v.id, { ...v }]));
  const customerMap = new Map(customersList.map(c => [c.id, c]));
  const washTypeMap = new Map(washTypesList.map(w => [w.id, w]));
  const workshopMap = new Map(workshopsList.map(w => [w.id, w]));
  const billMap = new Map(billsList.map(b => [b.job_id, b]));

  const pricingMap = new Map();
  pricingList.forEach(p => pricingMap.set(`${p.wash_type_id}_${p.segment}`, Number(p.price)));

  const workshopPricingMap = new Map();
  const defaultWorkshopPricingMap = new Map();
  workshopPricingList.forEach(wp => {
    if (wp.workshop_id) {
      workshopPricingMap.set(`${wp.workshop_id}_${wp.wash_type_id}_${wp.segment}`, Number(wp.price));
    } else {
      defaultWorkshopPricingMap.set(`${wp.wash_type_id}_${wp.segment}`, Number(wp.price));
    }
  });

  return rawJobs.map(job => {
    const vehicle = vehicleMap.get(job.vehicle_id) ? { ...vehicleMap.get(job.vehicle_id) } : null;
    if (vehicle && vehicle.customer_id) {
      const customer = customerMap.get(vehicle.customer_id);
      if (customer && customer.phone) vehicle.phone = customer.phone;
      if (customer && customer.name && !job.customer_name) job.customer_name = customer.name;
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
      } catch (e) {
        beforePhotosArr = [];
      }
    }

    let washPrice = 0;
    const segment = vehicle ? vehicle.segment : '';

    if (job.customer_type === 'workshop') {
      const cleanWId = (job.workshop_id && job.workshop_id !== 'null' && !isNaN(Number(job.workshop_id))) ? Number(job.workshop_id) : null;
      if (cleanWId && workshopPricingMap.has(`${cleanWId}_${job.wash_type_id}_${segment}`)) {
        washPrice = workshopPricingMap.get(`${cleanWId}_${job.wash_type_id}_${segment}`);
      } else if (defaultWorkshopPricingMap.has(`${job.wash_type_id}_${segment}`)) {
        washPrice = defaultWorkshopPricingMap.get(`${job.wash_type_id}_${segment}`);
      } else if (pricingMap.has(`${job.wash_type_id}_${segment}`)) {
        washPrice = pricingMap.get(`${job.wash_type_id}_${segment}`);
      } else {
        washPrice = segment === 'scooter' ? 250 : (segment === 'bike' ? 250 : 0);
      }
    } else {
      if (pricingMap.has(`${job.wash_type_id}_${segment}`)) {
        washPrice = pricingMap.get(`${job.wash_type_id}_${segment}`);
      } else {
        washPrice = segment === 'scooter' ? 250 : (segment === 'bike' ? 250 : 0);
      }
    }

    const lubePrice = job.has_chain_lube ? (Number(job.chain_lube_price) || 150) : 0;
    const totalPrice = job.offer_price !== null && job.offer_price !== undefined
      ? Number(job.offer_price)
      : washPrice + lubePrice;

    const effectiveWashPrice = job.offer_price !== null && job.offer_price !== undefined
      ? Math.max(0, Number(job.offer_price) - lubePrice)
      : washPrice;

    const cleanWIdForSelect = (job.workshop_id && job.workshop_id !== 'null' && !isNaN(Number(job.workshop_id))) ? Number(job.workshop_id) : null;
    const workshop = cleanWIdForSelect ? (workshopMap.get(cleanWIdForSelect) || null) : null;
    const washType = washTypeMap.get(job.wash_type_id) || null;
    const bill = billMap.get(job.id) || null;
    const paidAmount = job.payment_status === 'settled' ? totalPrice : (Number(job.paid_amount) || 0);

    return {
      ...job,
      customer_name: job.customer_name || '',
      before_photos: beforePhotosArr,
      vehicle,
      wash_type: washType,
      price: totalPrice,
      paid_amount: paidAmount,
      wash_price: effectiveWashPrice,
      chain_lube_price: lubePrice,
      workshop,
      bill
    };
  });
}

async function getJobFull(id) {
  const jobs = await getJobsFullBatch([id]);
  return jobs[0] || null;
}

// Create a job. Body: { reg_number, wash_type_id, eta_minutes, phone, customer_name, before_photos, has_chain_lube, chain_lube_price, offer_price, customer_type, workshop_id, payment_status }
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
      offer_price,
      customer_type,
      workshop_id,
      payment_status,
      payment_method,
      status,
      entry_time,
      exit_time,
      completed_at
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

    const regNumber = reg_number.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'UNREGISTERED';
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
    const parsedOfferPrice = (offer_price !== undefined && offer_price !== null && offer_price !== '')
      ? Number(offer_price)
      : null;

    if (parsedOfferPrice !== null && (!Number.isFinite(parsedOfferPrice) || parsedOfferPrice < 0)) {
      return res.status(400).json({ error: 'A valid offer price is required' });
    }
    const custType = customer_type === 'workshop' ? 'workshop' : 'normal';
    const wId = (custType === 'workshop' && workshop_id && workshop_id !== 'null' && !isNaN(Number(workshop_id)))
      ? Number(workshop_id)
      : null;
    const payStatus = payment_status === 'settled' ? 'settled' : 'unsettled';

    let photosJson = null;
    if (before_photos && Array.isArray(before_photos) && before_photos.length > 0) {
      photosJson = JSON.stringify(before_photos);
    }

    // Determine custom timestamps & status for backdated jobs
    let jobEntryTime = nowISO();
    if (entry_time) {
      const dt = new Date(entry_time);
      if (!isNaN(dt.getTime())) jobEntryTime = dt.toISOString();
    }

    const jobStatus = (status === 'completed' || completed_at) ? 'completed' : 'in_progress';
    let jobExitTime = null;
    if (jobStatus === 'completed') {
      if (exit_time || completed_at) {
        const dtExit = new Date(exit_time || completed_at);
        if (!isNaN(dtExit.getTime())) jobExitTime = dtExit.toISOString();
        else jobExitTime = jobEntryTime;
      } else {
        jobExitTime = jobEntryTime;
      }
    }

    const info = await db.prepare(
      'INSERT INTO jobs (vehicle_id, wash_type_id, entry_time, exit_time, eta_minutes, status, has_chain_lube, chain_lube_price, offer_price, customer_type, workshop_id, payment_status, customer_name, before_photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(vehicle.id, cleanWashTypeId, jobEntryTime, jobExitTime, Number(eta_minutes) || 30, jobStatus, chainLube, lubePrice, parsedOfferPrice, custType, wId, payStatus, custName, photosJson);

    const fullJob = await getJobFull(info.lastInsertRowid);
    const payMethod = (payment_method || 'cash').toLowerCase();
    const finalPrice = fullJob.price || 0;
    let cashAmt = 0;
    let gpayAmt = 0;
    if (payMethod === 'split') {
      cashAmt = Number(req.body.cash_amount) || 0;
      gpayAmt = Number(req.body.gpay_amount) || Math.max(0, finalPrice - cashAmt);
    } else if (payMethod === 'gpay') {
      cashAmt = 0;
      gpayAmt = finalPrice;
    } else {
      cashAmt = finalPrice;
      gpayAmt = 0;
    }

    if (payStatus === 'settled') {
      const paidAtTime = jobExitTime || jobEntryTime;
      await db.prepare(`
        INSERT INTO bills (job_id, amount, discount_amount, final_amount, payment_method, cash_amount, gpay_amount, reward_points_earned, reward_points_redeemed, status, paid_at)
        VALUES (?, ?, 0, ?, ?, ?, ?, 0, 0, 'paid', ?)
      `).run(fullJob.id, finalPrice, finalPrice, payMethod, cashAmt, gpayAmt, paidAtTime);
    }

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
    
    const fullJobs = await getJobsFullBatch(jobs);
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

    const { status, payment_status, customer_type, workshop_id, offer_price } = req.body;

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

    let newOfferPrice = job.offer_price;
    if (offer_price !== undefined) {
      const p = Number(offer_price);
      newOfferPrice = (offer_price !== null && offer_price !== '' && Number.isFinite(p) && p >= 0) ? p : null;
    }

    await db.prepare(
      'UPDATE jobs SET status = ?, exit_time = ?, payment_status = ?, customer_type = ?, workshop_id = ?, offer_price = ? WHERE id = ?'
    ).run(newStatus, exitTime, newPayStatus, newCustType, newWId, newOfferPrice, job.id);

    const fullJob = await getJobFull(job.id);

    const existingBill = await db.prepare('SELECT * FROM bills WHERE job_id = ?').get(job.id);
    if (existingBill) {
      const newBillStatus = newPayStatus === 'settled' ? 'paid' : (existingBill.status || 'unpaid');
      await db.prepare("UPDATE bills SET amount = ?, final_amount = ?, status = ? WHERE id = ?")
        .run(fullJob.price, fullJob.price, newBillStatus, existingBill.id);
    } else if (newPayStatus === 'settled') {
      await db.prepare(`
        INSERT INTO bills (job_id, amount, discount_amount, final_amount, payment_method, reward_points_earned, reward_points_redeemed, status, paid_at)
        VALUES (?, ?, 0, ?, 'cash', 0, 0, 'paid', ?)
      `).run(job.id, fullJob.price, fullJob.price, nowISO());
    }
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

router.delete('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    await db.prepare('DELETE FROM bills WHERE job_id = ?').run(jobId);
    await db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    res.json({ success: true, message: 'Job deleted successfully', id: Number(jobId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getJobFull = getJobFull;
module.exports.getJobsFullBatch = getJobsFullBatch;
