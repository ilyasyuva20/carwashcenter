/**
 * Vehicle info lookup service.
 * Supports both:
 * 1. RapidAPI VAHAN Provider (Fast, highly accurate RTO data)
 * 2. Puppeteer Free Scraper (Headless Chrome browser automation)
 */

require('dotenv').config();
const { scrapeVehicleDetails } = require('./rtoScraper');

// Helper to map RTO vehicle category string to internal segment
function normalizeCategory(vehicleClass = '', modelName = '', brandName = '', isScooterFlag = false) {
  const cls = (vehicleClass || '').toUpperCase();
  const mdl = (modelName || '').toUpperCase();
  const brd = (brandName || '').toUpperCase();

  if (isScooterFlag) {
    return 'scooter';
  }

  // Known motorcycles & motorcycle brands -> bike
  if (
    mdl.includes('BULLET') || mdl.includes('CLASSIC') || mdl.includes('PULSAR') ||
    mdl.includes('APACHE') || mdl.includes('SHINE') || mdl.includes('SPLENDOR') ||
    mdl.includes('DUKE') || mdl.includes('ROYAL') || mdl.includes('HUNTER') ||
    mdl.includes('METEOR') || mdl.includes('HIMALAYAN') || mdl.includes('UNICORN') ||
    mdl.includes('PASSION') || mdl.includes('GLAMOUR') || mdl.includes('PLATINA') ||
    mdl.includes('CT100') || mdl.includes('AVENGER') || mdl.includes('DOMINAR') ||
    mdl.includes('MT 15') || mdl.includes('MT15') || mdl.includes('YZF') || mdl.includes('R15') ||
    mdl.includes('FZ') || mdl.includes('GIXXER') || mdl.includes('RAIDER') || mdl.includes('RONIN') ||
    brd.includes('ROYAL') || brd.includes('RE') || brd.includes('JAWA') || brd.includes('YEZDI') ||
    brd.includes('KTM') || brd.includes('HARLEY') || brd.includes('TRIUMPH') || brd.includes('DUCATI')
  ) {
    return 'bike';
  }

  // Scooter checks
  if (
    cls.includes('SCOOTER') || cls.includes('SCOOTY') || mdl.includes('ACTIVA') ||
    mdl.includes('JUPITER') || mdl.includes('ACCESS') || mdl.includes('NTORQ') ||
    mdl.includes('VESPA') || mdl.includes('BURGMAM') || mdl.includes('BURGMAN') ||
    mdl.includes('DIO') || mdl.includes('PLEASURE') || mdl.includes('MAESTRO') ||
    mdl.includes('DESTINI') || mdl.includes('FASCINO') || mdl.includes('RAY') ||
    mdl.includes('AEROX') || mdl.includes('CHETAK') || mdl.includes('OLA') ||
    mdl.includes('ATHER') || mdl.includes('IQUBE') || brd.includes('OLA') || brd.includes('ATHER')
  ) {
    return 'scooter';
  }

  // 2-wheeler / Motorcycle check
  if (
    cls.includes('TWO WHEELER') || cls.includes('MOTORCYCLE') || cls.includes('M-CYCLE') ||
    cls.includes('M/CYLCE') || cls.includes('CYLCE') || cls.includes('BIKE') || cls.includes('2WN') ||
    cls.includes('2-W')
  ) {
    return 'bike';
  }

  // Premium Hatchback check
  if (
    mdl.includes('I20') || mdl.includes('BALENO') || mdl.includes('ALTROZ') ||
    mdl.includes('GLANZA') || mdl.includes('JAZZ') || mdl.includes('POLO') ||
    mdl.includes('COOPER')
  ) return 'premium_hatch';

  // MUV check
  if (
    cls.includes('MUV') || mdl.includes('INNOVA') || mdl.includes('ERTIGA') ||
    mdl.includes('CARENS') || mdl.includes('XL6') || mdl.includes('TRIBER') ||
    mdl.includes('CARNIVAL') || mdl.includes('MARAZZO') || mdl.includes('LODGY')
  ) return 'muv';

  // Premium Sedan / Premium SUV check
  if (
    mdl.includes('SUPERB') || mdl.includes('OCTAVIA') || mdl.includes('CAMRY') ||
    mdl.includes('PASSAT') || mdl.includes('ACCORD') || mdl.includes('FORTUNER') ||
    mdl.includes('ENDEAVOUR') || mdl.includes('HARRIER') || mdl.includes('SAFARI') ||
    mdl.includes('GLOSTER') || mdl.includes('MERIDIAN') || mdl.includes('DEFENDER') ||
    brd.includes('BMW') || brd.includes('MERCEDES') || brd.includes('AUDI') ||
    brd.includes('JAGUAR') || brd.includes('VOLVO') || brd.includes('PORSCHE')
  ) return 'premium_sedan_suv';

  // Full SUV check
  if (
    cls.includes('SUV') || mdl.includes('THAR') || mdl.includes('XUV') ||
    mdl.includes('SCORPIO') || mdl.includes('HECTOR') || mdl.includes('COMPASS') ||
    mdl.includes('RUBICON') || mdl.includes('WRANGLER') || mdl.includes('DISCOVERY') ||
    mdl.includes('PAJERO') || mdl.includes('BOLERO')
  ) return 'suv';

  // Sedan / Compact SUV check
  if (
    cls.includes('SEDAN') || cls.includes('COMPACT SUV') || cls.includes('MINI SUV') ||
    mdl.includes('CITY') || mdl.includes('VERNA') || mdl.includes('DZIRE') ||
    mdl.includes('DESIRE') || mdl.includes('CIAZ') || mdl.includes('SLAVIA') ||
    mdl.includes('VIRTUS') || mdl.includes('AMAZE') || mdl.includes('TIGOR') ||
    mdl.includes('AURA') || mdl.includes('NEXON') || mdl.includes('BREZZA') ||
    mdl.includes('VENUE') || mdl.includes('SELTOS') || mdl.includes('SONET') ||
    mdl.includes('PUNCH') || mdl.includes('EXTER') || mdl.includes('CRETA') ||
    mdl.includes('KIGER') || mdl.includes('MAGNITE') || mdl.includes('TAIGUN') ||
    mdl.includes('KUSHAQ') || mdl.includes('ASTOR') || mdl.includes('FRONX') ||
    mdl.includes('HYRYDER') || mdl.includes('GRAND VITARA') || mdl.includes('ECOSPORT') ||
    mdl.includes('WR-V') || mdl.includes('WRV')
  ) return 'sedan_compact_suv';

  return 'hatchback';
}

function cleanBrandName(maker = '') {
  if (!maker) return '';
  let trimmed = maker.trim().replace(/-/g, ' ');
  const words = trimmed.split(/\s+/).slice(0, 2);
  const cleaned = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  if (cleaned.toLowerCase().includes('tvs')) return 'TVS';
  if (cleaned.toLowerCase().includes('bmw')) return 'BMW';
  if (cleaned.toLowerCase().includes('mg')) return 'MG';
  if (cleaned.toLowerCase().includes('tata')) return 'Tata';
  if (cleaned.toLowerCase().includes('maruti')) return 'Maruti Suzuki';
  return cleaned;
}

async function fetchFromRapidAPI(regNumber) {
  const apiKey = process.env.RAPIDAPI_KEY || '30d0939832mshb7e7505741b8692p17d925jsn621e18942f95';
  const apiHost = process.env.RAPIDAPI_HOST || 'rto-vehicle-info1.p.rapidapi.com';
  const apiUrl = `https://${apiHost}/?rc=${encodeURIComponent(regNumber)}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    const vData = json?.data;

    if (!vData || json.status !== 'success') {
      return {
        reg_number: regNumber.toUpperCase(),
        brand: '',
        model: '',
        segment: 'hatchback',
        color: '',
        source: 'manual-entry',
        not_found: true
      };
    }

    const vehicleClass = vData.vehicle_category_description || vData.vehicle_category || vData.body_type || '';
    const makerName = vData.makeData?.v_make_name || vData.maker_description || '';
    const modelName = vData.maker_model || vData.model || '';
    const colorName = vData.color || 'White';
    const brand = cleanBrandName(makerName);
    const isScooterFlag = vData.makeData?.is_scooter === 1 || vData.makeData?.only_scooter === 1;

    return {
      reg_number: regNumber.toUpperCase(),
      brand: brand || '',
      model: modelName || '',
      segment: normalizeCategory(vehicleClass, modelName, brand, isScooterFlag),
      color: colorName,
      source: 'vahan-live-api',
      not_found: false
    };
  } catch (err) {
    console.warn(`[RTO RapidAPI Warning]: ${err.message}`);
    return {
      reg_number: regNumber.toUpperCase(),
      brand: '',
      model: '',
      segment: 'hatchback',
      color: '',
      source: 'manual-entry',
      not_found: true
    };
  }
}

async function fetchFromAPISetu(regNumber) {
  const apiKey = process.env.APISETU_API_KEY;
  const clientId = process.env.APISETU_CLIENT_ID;
  if (!apiKey || !clientId) {
    console.warn('[APISetu]: APISETU_API_KEY or APISETU_CLIENT_ID missing in .env');
    return null;
  }

  const apiUrl = 'https://apisetu.gov.in/morth/v1/registration/rc';
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'X-APISETU-APIKEY': apiKey,
        'X-APISETU-CLIENTID': clientId,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ regNo: regNumber })
    });

    if (!response.ok) {
      throw new Error(`APISetu HTTP ${response.status}`);
    }

    const data = await response.json();
    const maker = data.maker || data.makerDescription || '';
    const modelName = data.makerModel || data.model || '';
    const color = data.color || 'White';
    const vehicleClass = data.vehicleCategory || data.vehicleClass || '';
    const brand = cleanBrandName(maker);

    return {
      reg_number: regNumber.toUpperCase(),
      brand: brand || 'Vehicle',
      model: modelName || 'Model',
      segment: normalizeCategory(vehicleClass, modelName, brand),
      color: color,
      source: 'apisetu-morth',
      not_found: false
    };
  } catch (err) {
    console.warn(`[APISetu Warning]: ${err.message}`);
    return null;
  }
}

async function lookupVehicle(regNumber) {
  const method = (process.env.LOOKUP_METHOD || 'apisetu').toLowerCase();

  if (method === 'apisetu') {
    const apiSetuResult = await fetchFromAPISetu(regNumber);
    if (apiSetuResult && !apiSetuResult.not_found) {
      return apiSetuResult;
    }
  }

  // Fallback to Puppeteer scraper if APISetu is pending/not set or vehicle not found
  console.log(`[RTO Lookup]: Querying free Puppeteer scraper for ${regNumber}...`);
  try {
    const scraped = await scrapeVehicleDetails(regNumber);
    if (scraped && !scraped.not_found && (scraped.brand || scraped.model)) {
      return scraped;
    }
  } catch (err) {
    console.warn(`[Puppeteer Scraper Warning]: ${err.message}`);
  }

  return {
    reg_number: regNumber.toUpperCase(),
    brand: '',
    model: '',
    segment: 'hatchback',
    color: '',
    source: 'manual-entry',
    not_found: true
  };
}

module.exports = { lookupVehicle, normalizeCategory, cleanBrandName };
