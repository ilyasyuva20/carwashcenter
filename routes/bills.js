const express = require('express');
const router = express.Router();
const db = require('../db');
const { getJobFull } = require('./jobs');
const puppeteer = require('puppeteer');

const POINTS_PER_WASH = 10;
const REDEEM_THRESHOLD = 100;
const REDEEM_DISCOUNT_PCT = 50;

// Download PDF Receipt for a job
router.get('/pdf/:jobId', async (req, res) => {
  try {
    const job = getJobFull(req.params.jobId);
    if (!job) return res.status(404).send('Job not found');

    const isPaid = job.payment_status === 'settled' || (job.bill && job.bill.status === 'paid');
    const payMethod = (job.bill?.payment_method || 'CASH').toUpperCase();
    const completedVal = job.exit_time || job.completed_at || job.entry_time;
    const d = completedVal ? new Date(completedVal) : new Date();
    const dateOnlyStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeOnlyStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();

    let logoDataUrl = '';
    try {
      const fs = require('fs');
      const path = require('path');
      const logoPath = path.join(__dirname, '../logo.jpg');
      if (fs.existsSync(logoPath)) {
        const logoBuf = fs.readFileSync(logoPath);
        logoDataUrl = `data:image/jpeg;base64,${logoBuf.toString('base64')}`;
      }
    } catch (e) {
      console.error('Logo load error:', e);
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
          * { box-sizing: border-box; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0; padding: 0; background: #ffffff; color: #1e293b;
            -webkit-print-color-adjust: exact;
          }
          .invoice-container { padding: 20px 24px; max-width: 540px; margin: 0 auto; }
          .header-container {
            background: #ffffff;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
            overflow: hidden;
            margin-bottom: 20px;
          }
          .header-top {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 18px 20px;
            background: #ffffff;
            text-align: center;
          }
          .brand-logo {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            object-fit: cover;
            border: 2.5px solid #0f766e;
            box-shadow: 0 2px 8px rgba(15, 118, 110, 0.15);
          }
          .brand-title {
            font-size: 23px;
            font-weight: 900;
            letter-spacing: -0.02em;
            color: #0f172a;
            margin: 0 0 2px 0;
            text-transform: uppercase;
            text-align: left;
          }
          .brand-tagline {
            font-size: 11px;
            color: #0f766e;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            text-align: left;
          }
          .header-bottom {
            padding: 10px 20px;
            background: #f8fafc;
            font-size: 11px;
            color: #475569;
            font-weight: 600;
            border-top: 1px solid #edf2f7;
            text-align: center;
          }
          .contact-row-address {
            margin-bottom: 6px;
            color: #334155;
            font-weight: 600;
            text-align: center;
          }
          .contact-row-links {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
          }
          .contact-item {
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .header-stripe {
            height: 4px;
            background: linear-gradient(90deg, #0f172a 0%, #0f766e 50%, #0d9488 100%);
          }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
          .card-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; margin-bottom: 5px; }
          .info-row:last-child { margin-bottom: 0; }
          .info-label { color: #64748b; font-weight: 500; }
          .info-value { color: #0f172a; font-weight: 700; }
          .number-plate { background: #fef08a; color: #1e293b; border: 1.5px solid #0f172a; border-radius: 4px; padding: 2px 7px; font-family: monospace, sans-serif; font-weight: 900; font-size: 12px; letter-spacing: 0.08em; display: inline-block; }
          .table-container { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #0f766e; color: #ffffff; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; padding: 9px 12px; text-align: left; }
          th.text-right, td.text-right { text-align: right; }
          td { padding: 11px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; font-weight: 500; }
          tr:nth-child(even) td { background-color: #f8fafc; }
          tr:last-child td { border-bottom: none; }
          .item-name { font-weight: 700; color: #0f172a; font-size: 12.5px; }
          .addon-tag { color: #7e22ce; font-weight: 600; }
          .discount-tag { color: #047857; font-weight: 600; }
          .summary-wrapper { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
          .payment-stamp { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 8px; font-size: 11.5px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; border: 2px solid ${isPaid ? '#059669' : '#d97706'}; background-color: ${isPaid ? '#ecfdf5' : '#fffbeb'}; color: ${isPaid ? '#047857' : '#b45309'}; }
          .total-box { text-align: right; }
          .total-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 2px; }
          .total-amount { font-size: 21px; font-weight: 900; color: #0f766e; }
          .invoice-footer { text-align: center; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 10px; color: #94a3b8; }
          .footer-thanks { font-weight: 700; color: #475569; margin-bottom: 2px; }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header-container">
            <div class="header-top">
              ${logoDataUrl ? `<img src="${logoDataUrl}" class="brand-logo" alt="Perfecto Logo" />` : ''}
              <div>
                <h1 class="brand-title">PERFECTO WASH</h1>
                <div class="brand-tagline">The Perfect Carwash Center</div>
              </div>
            </div>
            <div class="header-bottom">
              <div class="contact-row-address">📍 Kunneparambu Rd, Vazhakkala, Kakkanad</div>
              <div class="contact-row-links">
                <span class="contact-item">📞 +91 99922 25924</span>
                <span class="contact-item">🌐 www.perfectocarwash.com</span>
              </div>
            </div>
            <div class="header-stripe"></div>
          </div>

          <div class="meta-grid">
            <div class="card">
              <div class="card-title">Receipt Info</div>
              <div class="info-row"><span class="info-label">Receipt:</span><span class="info-value" style="color: #0f766e;">#REC-${job.id}</span></div>
              <div class="info-row"><span class="info-label">Date:</span><span class="info-value">${dateOnlyStr}</span></div>
              <div class="info-row"><span class="info-label">Time:</span><span class="info-value">${timeOnlyStr}</span></div>
            </div>

            <div class="card">
              <div class="card-title">Vehicle & Customer</div>
              <div class="info-row"><span class="info-label">Reg No:</span><span class="number-plate">${job.vehicle?.reg_number || 'REG-N/A'}</span></div>
              <div class="info-row"><span class="info-label">Brand:</span><span class="info-value">${job.vehicle?.brand || '-'}</span></div>
              <div class="info-row"><span class="info-label">Model:</span><span class="info-value">${job.vehicle?.model || '-'}</span></div>
              <div class="info-row"><span class="info-label">Color:</span><span class="info-value">${job.vehicle?.color || '-'}</span></div>
              ${job.vehicle?.phone ? `<div class="info-row"><span class="info-label">Phone:</span><span class="info-value">+91 ${job.vehicle.phone}</span></div>` : ''}
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr><th>Service Description</th><th>Type</th><th class="text-right">Amount</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td class="item-name">${job.wash_type?.name || 'Wash Service'}</td>
                  <td><span style="background: #e0f2fe; color: #0369a1; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 9.5px;">PRIMARY</span></td>
                  <td class="text-right" style="font-weight: 700; color: #0f172a;">₹${job.wash_price || job.price}</td>
                </tr>
                ${job.has_chain_lube ? `
                <tr>
                  <td class="addon-tag">⚡ Chain Lube Spray Add-on</td>
                  <td><span style="background: #f3e8ff; color: #6b21a8; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 9.5px;">ADD-ON</span></td>
                  <td class="text-right addon-tag">+₹${job.chain_lube_price}</td>
                </tr>` : ''}
                ${job.bill?.discount_amount > 0 ? `
                <tr>
                  <td class="discount-tag">🎁 Loyalty Reward Discount</td>
                  <td><span style="background: #d1fae5; color: #047857; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 9.5px;">REWARD</span></td>
                  <td class="text-right discount-tag">-₹${job.bill.discount_amount}</td>
                </tr>` : ''}
              </tbody>
            </table>
          </div>

          <div class="summary-wrapper">
            <div class="payment-stamp">
              ${isPaid ? `✓ PAID VIA ${payMethod}` : '⏳ PAYMENT PENDING'}
            </div>
            <div class="total-box">
              <div class="total-label">NET TOTAL PAID</div>
              <div class="total-amount">₹${job.price}</div>
            </div>
          </div>

          <div class="invoice-footer">
            <div class="footer-thanks">Thank you for choosing Perfecto Wash! Drive Safe! 🚗✨</div>
            <div>Computer-generated receipt for services rendered.</div>
          </div>
        </div>
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '10px', bottom: '10px', left: '10px', right: '10px' }
    });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Receipt_${job.vehicle?.reg_number || job.id}.pdf"`);
    res.end(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).send('Error generating PDF receipt');
  }
});

// Preview what the bill would look like for a job (before payment)
router.get('/preview/:jobId', (req, res) => {
  const job = getJobFull(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.price == null) return res.status(400).json({ error: 'No price configured for this segment/wash type' });

  let customer = null;
  if (job.vehicle.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.vehicle.customer_id);
  }
  const canRedeem = !!(customer && customer.reward_points >= REDEEM_THRESHOLD);

  res.json({
    job_id: job.id,
    reg_number: job.vehicle.reg_number,
    wash_type: job.wash_type.name,
    amount: job.price,
    customer,
    can_redeem: canRedeem,
    redeem_discount_pct: REDEEM_DISCOUNT_PCT,
    points_per_wash: POINTS_PER_WASH
  });
});

// Create + pay a bill. Body: { job_id, payment_method: 'cash'|'gpay', redeem: bool }
router.post('/', (req, res) => {
  const { job_id, payment_method, redeem } = req.body;
  const job = getJobFull(job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.price == null) return res.status(400).json({ error: 'No price configured for this segment/wash type' });
  if (job.bill) return res.status(400).json({ error: 'Bill already exists for this job' });

  let customer = null;
  if (job.vehicle.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(job.vehicle.customer_id);
  }

  let discount = 0;
  let pointsRedeemed = 0;
  if (redeem && customer && customer.reward_points >= REDEEM_THRESHOLD) {
    discount = Math.round(job.price * (REDEEM_DISCOUNT_PCT / 100));
    pointsRedeemed = REDEEM_THRESHOLD;
  }
  const finalAmount = Math.max(0, job.price - discount);

  const info = db.prepare(`
    INSERT INTO bills (job_id, amount, discount_amount, final_amount, payment_method, reward_points_earned, reward_points_redeemed, status, paid_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)
  `).run(job.id, job.price, discount, finalAmount, payment_method, POINTS_PER_WASH, pointsRedeemed, new Date().toISOString());

  if (customer) {
    const newPoints = customer.reward_points - pointsRedeemed + POINTS_PER_WASH;
    db.prepare('UPDATE customers SET reward_points = ? WHERE id = ?').run(newPoints, customer.id);
  }

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ...bill, job });
});

// Get Normal Retail Customer Bills & Summary
router.get('/', (req, res) => {
  const { date, startDate, endDate, segment, payment_status, q } = req.query;

  // 1. Fetch completed normal customer jobs
  let rawJobs = db.prepare(`
    SELECT id, entry_time, exit_time, payment_status 
    FROM jobs 
    WHERE (customer_type != 'workshop' OR customer_type IS NULL) 
      AND status = 'completed'
    ORDER BY id DESC
  `).all();

  // Date filtering
  if (startDate && endDate) {
    rawJobs = rawJobs.filter(j => {
      const d = (j.exit_time || j.entry_time || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  } else if (date) {
    rawJobs = rawJobs.filter(j => (j.exit_time || j.entry_time || '').startsWith(date));
  }

  // Map to full job objects
  let jobs = rawJobs.map(j => getJobFull(j.id)).filter(Boolean);

  // Segment filtering
  if (segment && segment !== 'all') {
    if (segment === 'car') {
      jobs = jobs.filter(j => j.vehicle?.segment !== 'bike' && j.vehicle?.segment !== 'scooter');
    } else if (segment === 'bike') {
      jobs = jobs.filter(j => j.vehicle?.segment === 'bike' || j.vehicle?.segment === 'scooter');
    }
  }

  // Search filter for summary dataset
  let summaryJobs = [...jobs];

  // Payment status filtering ('unpaid'/'unsettled' vs 'paid'/'settled')
  if (payment_status && payment_status !== 'all') {
    if (payment_status === 'unpaid' || payment_status === 'unsettled') {
      jobs = jobs.filter(j => j.payment_status !== 'settled' && (!j.bill || j.bill.status !== 'paid'));
    } else if (payment_status === 'paid' || payment_status === 'settled') {
      jobs = jobs.filter(j => j.payment_status === 'settled' || (j.bill && j.bill.status === 'paid'));
    }
  }

  // Search filter
  if (q) {
    const search = q.toLowerCase().trim();
    jobs = jobs.filter(j =>
      (j.vehicle?.reg_number || '').toLowerCase().includes(search) ||
      (j.vehicle?.phone || '').toLowerCase().includes(search) ||
      (j.vehicle?.brand || '').toLowerCase().includes(search) ||
      (j.vehicle?.model || '').toLowerCase().includes(search)
    );
  }

  let totalCars = 0;
  let totalBikes = 0;
  let totalAmount = 0;
  let unpaidAmount = 0;
  let paidAmount = 0;

  summaryJobs.forEach(j => {
    const isBike = j.vehicle?.segment === 'bike' || j.vehicle?.segment === 'scooter';
    if (isBike) totalBikes++;
    else totalCars++;

    const price = j.bill?.final_amount != null ? j.bill.final_amount : (j.price || 0);
    totalAmount += price;

    if (j.payment_status === 'settled' || (j.bill && j.bill.status === 'paid')) {
      paidAmount += price;
    } else {
      unpaidAmount += price;
    }
  });

  res.json({
    summary: {
      total_cars: totalCars,
      total_bikes: totalBikes,
      total_vehicles: totalCars + totalBikes,
      total_amount: totalAmount,
      unpaid_amount: unpaidAmount,
      paid_amount: paidAmount
    },
    jobs
  });
});

router.get('/workshop-summary', (req, res) => {
  const { date, startDate, endDate, type, workshop_id, payment_status, q } = req.query;

  let workshops = db.prepare('SELECT * FROM workshops ORDER BY name ASC').all();
  if (type && type !== 'all') {
    workshops = workshops.filter(w => w.type === type);
  }
  if (workshop_id && workshop_id !== 'all') {
    workshops = workshops.filter(w => String(w.id) === String(workshop_id));
  }
  if (q) {
    const search = q.toLowerCase();
    workshops = workshops.filter(w =>
      (w.name || '').toLowerCase().includes(search) ||
      (w.phone || '').toLowerCase().includes(search) ||
      (w.owner_name || '').toLowerCase().includes(search)
    );
  }

  let rawJobs = db.prepare("SELECT id, entry_time, workshop_id, payment_status FROM jobs WHERE customer_type = 'workshop' ORDER BY id DESC").all();

  if (startDate && endDate) {
    rawJobs = rawJobs.filter(j => {
      const d = (j.entry_time || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });
  } else if (date) {
    rawJobs = rawJobs.filter(j => (j.entry_time || '').startsWith(date));
  }

  if (payment_status && payment_status !== 'all') {
    rawJobs = rawJobs.filter(j => j.payment_status === payment_status);
  }

  const fullJobs = rawJobs.map(j => getJobFull(j.id)).filter(Boolean);

  const workshopMap = {};
  workshops.forEach(w => {
    workshopMap[w.id] = {
      ...w,
      cars_count: 0,
      bikes_count: 0,
      total_vehicles: 0,
      total_amount: 0,
      unpaid_amount: 0,
      paid_amount: 0,
      jobs: []
    };
  });

  let unassignedJobs = [];
  let overallCars = 0;
  let overallBikes = 0;
  let overallAmount = 0;
  let overallUnpaid = 0;
  let overallPaid = 0;

  fullJobs.forEach(job => {
    const isBikeOrScooter = job.vehicle?.segment === 'bike' || job.vehicle?.segment === 'scooter';
    const isCar = !isBikeOrScooter;

    // Strict category filtering: Car Workshop only gets Car jobs, Bike Workshop only gets Bike jobs
    if (type === 'Car Workshop' && !isCar) return;
    if (type === 'Bike Workshop' && !isBikeOrScooter) return;

    if (isCar) overallCars++;
    else overallBikes++;

    const price = job.price || 0;
    overallAmount += price;
    if (job.payment_status === 'settled') {
      overallPaid += price;
    } else {
      overallUnpaid += price;
    }

    if (job.workshop_id && workshopMap[job.workshop_id]) {
      const w = workshopMap[job.workshop_id];
      w.jobs.push(job);
      w.total_vehicles++;
      if (isCar) w.cars_count++;
      else w.bikes_count++;
      w.total_amount += price;
      if (job.payment_status === 'settled') {
        w.paid_amount += price;
      } else {
        w.unpaid_amount += price;
      }
    } else if (!job.workshop_id) {
      unassignedJobs.push(job);
    }
  });

  res.json({
    summary: {
      total_cars: overallCars,
      total_bikes: overallBikes,
      total_vehicles: overallCars + overallBikes,
      total_amount: overallAmount,
      unpaid_amount: overallUnpaid,
      paid_amount: overallPaid
    },
    workshops: Object.values(workshopMap),
    unassigned_jobs: unassignedJobs
  });
});

// Single job settlement endpoint
router.post('/settle-job', (req, res) => {
  const { job_id, payment_method } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  const job = getJobFull(job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const payMethod = payment_method || 'cash';
  const now = new Date().toISOString();

  db.prepare("UPDATE jobs SET payment_status = 'settled' WHERE id = ?").run(job.id);

  const existingBill = db.prepare('SELECT * FROM bills WHERE job_id = ?').get(job.id);
  if (existingBill) {
    db.prepare("UPDATE bills SET status = 'paid', payment_method = ?, paid_at = ? WHERE id = ?")
      .run(payMethod, now, existingBill.id);
  } else {
    db.prepare(`
      INSERT INTO bills (job_id, amount, discount_amount, final_amount, payment_method, reward_points_earned, reward_points_redeemed, status, paid_at)
      VALUES (?, ?, 0, ?, ?, 0, 0, 'paid', ?)
    `).run(job.id, job.price, job.price, payMethod, now);
  }

  res.json({ ok: true, job: getJobFull(job.id) });
});

// Bulk workshop settlement endpoint
router.post('/settle-workshop', (req, res) => {
  const { job_ids, payment_method, itemized_payments } = req.body;
  if (!Array.isArray(job_ids) || job_ids.length === 0) {
    return res.status(400).json({ error: 'job_ids array is required' });
  }

  const defaultMethod = payment_method || 'cash';
  const now = new Date().toISOString();
  let settledCount = 0;
  let totalSettledAmount = 0;

  const updateJobStmt = db.prepare("UPDATE jobs SET payment_status = 'settled' WHERE id = ?");
  const getBillStmt = db.prepare('SELECT * FROM bills WHERE job_id = ?');
  const updateBillStmt = db.prepare("UPDATE bills SET status = 'paid', payment_method = ?, paid_at = ? WHERE id = ?");
  const insertBillStmt = db.prepare(`
    INSERT INTO bills (job_id, amount, discount_amount, final_amount, payment_method, reward_points_earned, reward_points_redeemed, status, paid_at)
    VALUES (?, ?, 0, ?, ?, 0, 0, 'paid', ?)
  `);

  const transaction = db.transaction(() => {
    for (const id of job_ids) {
      const job = getJobFull(id);
      if (!job) continue;

      const method = (itemized_payments && itemized_payments[id]) ? itemized_payments[id] : defaultMethod;

      updateJobStmt.run(job.id);

      const existingBill = getBillStmt.get(job.id);
      if (existingBill) {
        updateBillStmt.run(method, now, existingBill.id);
      } else {
        insertBillStmt.run(job.id, job.price, job.price, method, now);
      }

      settledCount++;
      totalSettledAmount += (job.price || 0);
    }
  });

  transaction();

  res.json({
    ok: true,
    settled_count: settledCount,
    total_amount: totalSettledAmount
  });
});

module.exports = router;
