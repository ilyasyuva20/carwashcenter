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

  if (PLATE_REGEX_STRICT.test(clean)) return clean;

  const letterToDigit = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'E': '3', 'A': '4', 'S': '5', 'G': '6', 'T': '7', 'B': '8', 'N': '9' };
  const digitToLetter = { '0': 'O', '1': 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B', '9': 'N' };

  if (clean.length >= 8 && clean.length <= 11) {
    let state = clean.slice(0, 2);
    let stateFixed = state.split('').map(ch => digitToLetter[ch] || ch).join('');
    if (stateFixed === 'KE' || stateFixed === 'KI' || stateFixed === 'K1') stateFixed = 'KL';
    else if (!INDIAN_STATES.includes(stateFixed)) {
      if (stateFixed.startsWith('K')) stateFixed = 'KL';
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

function parsePlateFromText(rawText) {
  if (!rawText) return '';
  const textUpper = rawText.toUpperCase();
  
  const lines = textUpper
    .split(/[\r\n]+/)
    .map(l => l.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  // 1. Direct line match or repaired line match
  for (const line of lines) {
    let lm = line.match(PLATE_REGEX_SEARCH);
    if (lm) return lm[0];

    let rep = repairPlateString(line);
    if (PLATE_REGEX_STRICT.test(rep)) return rep;
  }

  // 2. Multi-line combinations repaired (filtering watermark words)
  const plateLinesOnly = lines.filter(l => l !== 'IND' && l !== 'INDIA' && l !== 'HERO' && l !== 'HONDA' && l !== 'ATHER' && l !== 'PALAL' && l !== 'MOBILITY');
  for (let i = 0; i < plateLinesOnly.length - 1; i++) {
    const combined = plateLinesOnly[i] + plateLinesOnly[i + 1];
    let cm = combined.match(PLATE_REGEX_SEARCH);
    if (cm) return cm[0];

    let rep = repairPlateString(combined);
    if (PLATE_REGEX_STRICT.test(rep)) return rep;

    if (i < plateLinesOnly.length - 2) {
      const combined3 = plateLinesOnly[i] + plateLinesOnly[i + 1] + plateLinesOnly[i + 2];
      let cm3 = combined3.match(PLATE_REGEX_SEARCH);
      if (cm3) return cm3[0];

      let rep3 = repairPlateString(combined3);
      if (PLATE_REGEX_STRICT.test(rep3)) return rep3;
    }
  }

  // 3. Fallback 4-digit number extraction
  const combinedPlateText = plateLinesOnly.join('');
  const partialWithState = combinedPlateText.match(/[A-Z]{2}[0-9]{0,4}[0-9]{4}/);
  if (partialWithState) return partialWithState[0];

  const fourDigit = combinedPlateText.match(FOUR_DIGIT_REGEX);
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

module.exports = router;
