const express = require('express');
const router = express.Router();

const INDIAN_STATES = [
  'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HR',
  'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ',
  'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UA', 'UP', 'WB'
];

const PLATE_REGEX_STRICT = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
const PLATE_REGEX_SEARCH = /[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2}/;
const FOUR_DIGIT_REGEX = /[0-9]{4}/;

function repairPlateString(str) {
  if (!str) return '';
  const clean = str.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const stateCode = clean.slice(0, 2);
  const isValidState = INDIAN_STATES.includes(stateCode) || stateCode === 'BH';

  if (PLATE_REGEX_STRICT.test(clean) && isValidState) return clean;

  const letterToDigit = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'E': '3', 'A': '4', 'S': '5', 'G': '6', 'T': '7', 'B': '8', 'N': '9' };
  const digitToLetter = { '0': 'O', '1': 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B', '9': 'N' };

  if (clean.length >= 8 && clean.length <= 11) {
    let state = clean.slice(0, 2);
    let stateFixed = state.split('').map(ch => digitToLetter[ch] || ch).join('');
    if (stateFixed === 'KE' || stateFixed === 'KI' || stateFixed === 'K1' || stateFixed === 'ZL' || stateFixed === '7L' || stateFixed === 'XL' || stateFixed === '2L' || stateFixed.endsWith('L')) {
      stateFixed = 'KL';
    } else if (!INDIAN_STATES.includes(stateFixed)) {
      if (stateFixed.startsWith('K') || stateFixed.endsWith('L')) stateFixed = 'KL';
      else if (stateFixed.startsWith('M')) stateFixed = 'MH';
      else if (stateFixed.startsWith('D')) stateFixed = 'DL';
      else if (stateFixed.startsWith('T')) stateFixed = 'TN';
      else if (stateFixed.startsWith('G')) stateFixed = 'GJ';
      else if (stateFixed.startsWith('H')) stateFixed = 'HR';
      else if (stateFixed.startsWith('U')) stateFixed = 'UP';
    }

    const rest = clean.slice(2);
    let last4 = rest.slice(-4).split('').map(ch => letterToDigit[ch] || ch).join('');
    let middle = rest.slice(0, -4);
    let dist = '';
    let series = '';

    for (let i = 0; i < middle.length; i++) {
      const ch = middle[i];
      if (i < 2 && /[0-9SZEAOGTB]/.test(ch)) {
        dist += letterToDigit[ch] || ch;
      } else {
        series += digitToLetter[ch] || ch;
      }
    }

    const candidate = `${stateFixed}${dist}${series}${last4}`;
    if (PLATE_REGEX_STRICT.test(candidate)) {
      return candidate;
    }
  }

  return clean;
}

const NOISE_WORDS = [
  'IND', 'INDIA', 'HERO', 'HONDA', 'ATHER', 'PALAL', 'MOBILITY', 'DEALER',
  'MOTORS', 'SUZUKI', 'MARUTI', 'HYUNDAI', 'TATA', 'YAMAHA', 'ENFIELD', 'KTM',
  'BAJAJ', 'VESPA', 'TVS', 'CHEVROLET', 'FORD', 'TOYOTA', 'VOLKSWAGEN', 'BMW',
  'BENZ', 'AUDI', 'NISSAN', 'MG', 'KIA', 'JEEP', 'RENAULT', 'MAHINDRA', 'SKODA',
  'NEXA', 'CAR', 'BIKE', 'EV', 'AUTO', 'GARAGE', 'WORKSHOP', 'SERVICE'
];

function cleanNoiseFromText(rawText) {
  let cleaned = (rawText || '').toUpperCase();
  for (const word of NOISE_WORDS) {
    const regex = new RegExp('\\b' + word + '\\b', 'g');
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned;
}

function parsePlateFromText(rawText) {
  if (!rawText) return '';
  const textUpper = rawText.toUpperCase();

  // 1. Direct regex search on whole un-cleaned text
  const cleanUnprocessed = textUpper.replace(/[^A-Z0-9]/g, '');
  let directMatch = cleanUnprocessed.match(PLATE_REGEX_SEARCH);
  if (directMatch) {
    let rep = repairPlateString(directMatch[0]);
    if (PLATE_REGEX_STRICT.test(rep)) return rep;
  }

  // 2. Clean out noise frame words first
  const cleanedText = cleanNoiseFromText(rawText);
  const lines = cleanedText
    .split(/[\r\n]+/)
    .map(l => l.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  // 3. Direct line match or repaired line match
  for (const line of lines) {
    let rep = repairPlateString(line);
    if (PLATE_REGEX_STRICT.test(rep)) {
      const st = rep.slice(0, 2);
      if (INDIAN_STATES.includes(st) || st === 'BH') return rep;
    }

    let lm = line.match(PLATE_REGEX_SEARCH);
    if (lm) {
      const repLm = repairPlateString(lm[0]);
      if (PLATE_REGEX_STRICT.test(repLm)) return repLm;
    }
  }

  // 4. Try all pairs of lines (including non-adjacent and reversed for 2-line plates)
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const combined = lines[i] + lines[j];
      let rep = repairPlateString(combined);
      if (PLATE_REGEX_STRICT.test(rep)) return rep;

      let cm = combined.match(PLATE_REGEX_SEARCH);
      if (cm) {
        const repCm = repairPlateString(cm[0]);
        if (PLATE_REGEX_STRICT.test(repCm)) return repCm;
      }
    }
  }

  // 5. Try 3-line combinations
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      for (let k = 0; k < lines.length; k++) {
        if (k === i || k === j) continue;
        const combined3 = lines[i] + lines[j] + lines[k];
        let rep3 = repairPlateString(combined3);
        if (PLATE_REGEX_STRICT.test(rep3)) return rep3;
      }
    }
  }

  // 6. Join ALL lines together without noise words
  const allJoined = lines.join('');
  let repAll = repairPlateString(allJoined);
  if (PLATE_REGEX_STRICT.test(repAll)) return repAll;

  // 7. Fallback 4-digit match
  const partialWithState = allJoined.match(/[A-Z]{2}[0-9]{0,4}[0-9]{4}/);
  if (partialWithState) return partialWithState[0];

  const fourDigit = allJoined.match(FOUR_DIGIT_REGEX);
  if (fourDigit) return fourDigit[0];

  return '';
}

// POST /api/ocr/scan
router.post('/scan', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY || 'K89818686888957';
    let base64Data = image;

    if (!base64Data.startsWith('data:image/')) {
      base64Data = `data:image/jpeg;base64,${base64Data}`;
    }

    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('base64Image', base64Data);
    formData.append('OCREngine', '2'); // Deep Learning AI Vision Engine
    formData.append('scale', 'true');
    formData.append('detectOrientation', 'true');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (data && data.ParsedResults && data.ParsedResults.length > 0) {
      const parsedText = data.ParsedResults[0].ParsedText || '';
      console.log('[AI VISION OCR RAW TEXT]:', parsedText);

      const plate = parsePlateFromText(parsedText);
      if (plate) {
        return res.json({ success: true, plate, rawText: parsedText, engine: 'OCR.space Engine 2' });
      }
    }

    return res.status(422).json({ success: false, error: 'Could not extract plate number from photo' });
  } catch (err) {
    console.error('OCR API Endpoint Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseInvoiceFromText(rawText) {
  if (!rawText) return {};

  const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  let supplierName = '';
  let invoiceNumber = '';
  let invoiceDate = '';
  let totalAmount = 0;
  let paidAmount = 0;
  let balanceAmount = 0;
  const items = [];

  // 1. Detect Supplier Name
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const line = lines[i];
    if (/tax invoice|original|recipient|bill to|invoice no|date|place of supply|gstin/i.test(line)) continue;

    if (/\b(LLP|PVT|LTD|TRADERS|ENTERPRISES|CARE|UPCARE|DISTRIBUTORS|AGENCIES|COMPANY|STORE|CHEMICALS|WORKSHOP|SUPPLIER)\b/i.test(line)) {
      supplierName = line.replace(/^(tax invoice|original for recipient|invoice)\s*/i, '').trim();
      break;
    }
  }

  if (!supplierName) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      if (!/tax invoice|original|recipient|invoice|bill|date|state/i.test(lines[i]) && lines[i].length > 3) {
        supplierName = lines[i];
        break;
      }
    }
  }

  // 2. Invoice Number
  const invNoMatch = rawText.match(/(?:Invoice\s*No|Inv\s*No|Bill\s*No|Invoice\s*#)[\s.:]*([A-Z0-9\/-]+)/i);
  if (invNoMatch) {
    invoiceNumber = invNoMatch[1];
  }

  // 3. Invoice Date
  const dateMatch = rawText.match(/(?:Date|Dated)[\s.:]*(\d{1,4}[-\/\.]\d{1,2}[-\/\.]\d{1,4})/i);
  if (dateMatch) {
    invoiceDate = dateMatch[1];
  }

  // 4. Line items table parser
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/item name|hsn|quantity|price|amount|taxable|cgst|sgst|sub total|grand total/i.test(line)) continue;

    const amountMatch = line.match(/(?:₹|\b)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*$/);
    if (amountMatch) {
      const lineAmt = parseFloat(amountMatch[1].replace(/,/g, ''));
      if (lineAmt > 0 && !/sub\s*total|total|tax|balance|due|payable|amount in words/i.test(line)) {
        let cleanItemLine = line
          .replace(/^\d+[\s.]*/, '')
          .replace(/(?:₹|\b)\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*$/, '')
          .replace(/\b\d{4,8}\b/g, '')
          .replace(/\(\d+%\)/g, '')
          .trim();

        const qtyMatch = line.match(/\b(\d+)\s*(?:Kg|L|Pcs|Boxes|Units|Bottles|Grams)?\b/i);
        const qty = qtyMatch ? qtyMatch[0] : '';

        if (cleanItemLine.length > 2) {
          items.push({
            name: cleanItemLine,
            qty: qty || '',
            amount: lineAmt
          });
        }
      }
    }
  }

  // 5. Total Billed Amount
  const totalMatch = rawText.match(/(?:Total|Grand Total|Sub Total|SubTotal|Invoice Amount)[\s.:]*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  if (totalMatch) {
    totalAmount = parseFloat(totalMatch[1].replace(/,/g, ''));
  }

  if (!totalAmount && items.length > 0) {
    totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  }

  // 6. Balance / Paid detection
  const balanceMatch = rawText.match(/(?:Balance|Balance Amount)[\s.:]*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  if (balanceMatch) {
    balanceAmount = parseFloat(balanceMatch[1].replace(/,/g, ''));
  }

  const paidMatch = rawText.match(/(?:Paid|Amount Paid|Advance Paid)[\s.:]*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  if (paidMatch) {
    paidAmount = parseFloat(paidMatch[1].replace(/,/g, ''));
  }

  return {
    supplier_name: supplierName || 'Unknown Supplier',
    invoice_number: invoiceNumber || '',
    invoice_date: invoiceDate || '',
    items,
    total_amount: totalAmount || 0,
    paid_amount: paidAmount || 0,
    balance_amount: balanceAmount || 0,
    raw_text: rawText
  };
}

// POST /api/ocr/scan-invoice
router.post('/scan-invoice', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY || 'K89818686888957';
    let base64Data = image;

    if (!base64Data.startsWith('data:image/')) {
      base64Data = `data:image/jpeg;base64,${base64Data}`;
    }

    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('base64Image', base64Data);
    formData.append('OCREngine', '2'); // Deep Learning AI Vision Engine
    formData.append('scale', 'true');
    formData.append('isTable', 'true');
    formData.append('detectOrientation', 'true');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (data && data.ParsedResults && data.ParsedResults.length > 0) {
      const parsedText = data.ParsedResults[0].ParsedText || '';
      console.log('[AI INVOICE OCR RAW TEXT]:', parsedText);

      const invoiceData = parseInvoiceFromText(parsedText);
      return res.json({ success: true, invoice: invoiceData, rawText: parsedText, engine: 'OCR.space Engine 2 AI' });
    }

    return res.status(422).json({ success: false, error: 'Could not read invoice content from photo' });
  } catch (err) {
    console.error('Invoice OCR API Endpoint Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

