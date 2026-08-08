const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/wash-types - List wash types with pricing & workshop_pricing
router.get('/', (req, res) => {
  const workshopId = req.query.workshop_id ? Number(req.query.workshop_id) : null;
  const types = db.prepare('SELECT * FROM wash_types').all();
  const normalPricing = db.prepare('SELECT * FROM pricing').all();
  const defaultWp = db.prepare('SELECT * FROM workshop_pricing WHERE workshop_id IS NULL').all();
  let specificWp = [];
  if (workshopId) {
    specificWp = db.prepare('SELECT * FROM workshop_pricing WHERE workshop_id = ?').all(workshopId);
  }

  const withPricing = types.map(t => {
    // Normal pricing mapping
    const nMap = normalPricing
      .filter(p => p.wash_type_id === t.id)
      .reduce((acc, p) => ({ ...acc, [p.segment]: p.price }), {});

    // Default workshop pricing mapping
    const defaultWpMap = defaultWp
      .filter(p => p.wash_type_id === t.id)
      .reduce((acc, p) => ({ ...acc, [p.segment]: p.price }), {});

    // Specific workshop pricing mapping (overrides default workshop pricing)
    const specificWpMap = specificWp
      .filter(p => p.wash_type_id === t.id)
      .reduce((acc, p) => ({ ...acc, [p.segment]: p.price }), {});

    // Effective workshop pricing: specific -> default -> normal
    const effectiveWpMap = { ...nMap, ...defaultWpMap, ...specificWpMap };

    return {
      ...t,
      pricing: nMap,
      default_workshop_pricing: defaultWpMap,
      workshop_pricing: effectiveWpMap
    };
  });

  res.json(withPricing);
});

// Update normal customer pricing
router.put('/pricing/:washTypeId/:segment', (req, res) => {
  const { price } = req.body;
  const { washTypeId, segment } = req.params;
  const numPrice = Number(price);

  const existing = db.prepare('SELECT * FROM pricing WHERE wash_type_id = ? AND segment = ?').get(washTypeId, segment);
  if (existing) {
    db.prepare('UPDATE pricing SET price = ? WHERE id = ?').run(numPrice, existing.id);
  } else {
    db.prepare('INSERT INTO pricing (wash_type_id, segment, price) VALUES (?, ?, ?)').run(washTypeId, segment, numPrice);
  }
  res.json({ ok: true });
});

// Update workshop customer pricing (specific workshop or default)
router.put('/workshop-pricing/:washTypeId/:segment', (req, res) => {
  const { price, workshop_id } = req.body;
  const { washTypeId, segment } = req.params;
  const numPrice = Number(price);
  const wId = workshop_id ? Number(workshop_id) : null;

  let existing;
  if (wId) {
    existing = db.prepare('SELECT * FROM workshop_pricing WHERE workshop_id = ? AND wash_type_id = ? AND segment = ?').get(wId, washTypeId, segment);
  } else {
    existing = db.prepare('SELECT * FROM workshop_pricing WHERE workshop_id IS NULL AND wash_type_id = ? AND segment = ?').get(washTypeId, segment);
  }

  if (existing) {
    db.prepare('UPDATE workshop_pricing SET price = ? WHERE id = ?').run(numPrice, existing.id);
  } else {
    db.prepare('INSERT INTO workshop_pricing (workshop_id, wash_type_id, segment, price) VALUES (?, ?, ?, ?)').run(wId, washTypeId, segment, numPrice);
  }

  res.json({ ok: true });
});

module.exports = router;
