/**
 * Vehicle info lookup service for RTO VAHAN Details.
 * Supports multiple providers:
 * 1. Sandbox.co.in VAHAN API (Official Indian KYC/RC API)
 * 2. RapidAPI VAHAN Provider
 * 3. Custom Indian RTO Provider (APICountry, Surepass, Cashfree)
 * 4. APISetu Govt MoRTH API
 * 5. Puppeteer Headless Browser Scraper (Free fallback)
 */

require('dotenv').config();
const { scrapeVehicleDetails } = require('./rtoScraper');

// Memory cache for Sandbox.co.in Authentication Token
let sandboxToken = null;
let sandboxTokenExpiresAt = 0;

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
  if (cleaned.toLowerCase().includes('hyundai')) return 'Hyundai';
  if (cleaned.toLowerCase().includes('honda')) return 'Honda';
  if (cleaned.toLowerCase().includes('hero')) return 'Hero';
  if (cleaned.toLowerCase().includes('yamaha')) return 'Yamaha';
  if (cleaned.toLowerCase().includes('royal')) return 'Royal Enfield';
  if (cleaned.toLowerCase().includes('bajaj')) return 'Bajaj';
  if (cleaned.toLowerCase().includes('mahindra')) return 'Mahindra';
  return cleaned;
}

function extractYear(dateStr = '') {
  if (!dateStr) return '';
  const match = dateStr.match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : '';
}

/**
 * 1. Sandbox.co.in VAHAN API Provider
 */
async function getSandboxToken() {
  const apiKey = process.env.SANDBOX_API_KEY;
  const apiSecret = process.env.SANDBOX_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.warn('[Sandbox.co.in]: SANDBOX_API_KEY or SANDBOX_API_SECRET missing in .env');
    return null;
  }

  // Return cached token if valid (valid for 12 hours)
  if (sandboxToken && Date.now() < sandboxTokenExpiresAt) {
    return sandboxToken;
  }

  try {
    console.log('[Sandbox.co.in]: Requesting new Access Token...');
    const response = await fetch('https://api.sandbox.co.in/authenticate', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
        'x-api-version': '1.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Auth failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    const token = data.access_token || data.data?.access_token;
    if (token) {
      sandboxToken = token;
      sandboxTokenExpiresAt = Date.now() + (12 * 60 * 60 * 1000); // 12 hours cache
      console.log('[Sandbox.co.in]: Access token acquired successfully!');
      return sandboxToken;
    }
  } catch (err) {
    console.error(`[Sandbox.co.in Auth Error]: ${err.message}`);
  }
  return null;
}

async function fetchFromSandbox(regNumber) {
  const token = await getSandboxToken();
  if (!token) return null;

  const apiKey = process.env.SANDBOX_API_KEY;

  // Try /kyc/rc/full or /kyc/rc/lite
  const endpoints = [
    `https://api.sandbox.co.in/kyc/rc/full?rc_number=${encodeURIComponent(regNumber)}`,
    `https://api.sandbox.co.in/kyc/rc/lite?rc_number=${encodeURIComponent(regNumber)}`
  ];

  for (const apiUrl of endpoints) {
    try {
      console.log(`[Sandbox.co.in]: Querying ${apiUrl.split('?')[0]}...`);
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'x-api-key': apiKey,
          'x-api-version': '1.0',
          'Accept': 'application/json'
        }
      });

      // Log RateLimit remaining header as requested
      const remainingLimit = response.headers.get('x-ratelimit-remaining') || response.headers.get('x-rate-limit-remaining');
      if (remainingLimit !== null) {
        console.log(`[Sandbox.co.in Header Check] Remaining Limit: ${remainingLimit}`);
      }

      if (!response.ok) {
        console.warn(`[Sandbox.co.in]: Endpoint ${apiUrl.split('?')[0]} returned HTTP ${response.status} (${response.statusText})`);
        continue;
      }

      const json = await response.json();
      const vData = json?.data || json?.result || json;

      if (!vData || json.code === 400 || json.code === 404) {
        continue;
      }

      const makerName = vData.maker_description || vData.maker || vData.brand || '';
      const modelName = vData.maker_model || vData.model || '';
      const colorName = vData.color || vData.vehicle_color || 'White';
      const vehicleClass = vData.vehicle_category_description || vData.vehicle_category || vData.vehicle_class || '';
      const yearVal = extractYear(vData.manufacturing_date || vData.manufacture_year || vData.registration_date || vData.reg_date || '');
      const brand = cleanBrandName(makerName);

      if (brand || modelName) {
        console.log(`[Sandbox.co.in SUCCESS]: Fetched vehicle details for ${regNumber}!`);
        console.log(`  ├─ Brand: ${brand}`);
        console.log(`  ├─ Model: ${modelName}`);
        console.log(`  ├─ Color: ${colorName}`);
        console.log(`  ├─ Year: ${yearVal || 'N/A'}`);
        console.log(`  └─ Category: ${vehicleClass}`);

        return {
          reg_number: regNumber.toUpperCase(),
          brand: brand || 'Vehicle',
          model: modelName || 'Model',
          segment: normalizeCategory(vehicleClass, modelName, brand),
          color: colorName,
          year: yearVal || '',
          source: 'sandbox-vahan-api',
          not_found: false
        };
      }
    } catch (err) {
      console.warn(`[Sandbox.co.in Warning]: ${err.message}`);
    }
  }

  return null;
}

/**
 * 2. RapidAPI VAHAN Provider (Supports rto-vehicle-details by flashbomberapp & other hosts)
 */
async function fetchFromRapidAPI(regNumber) {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST || 'rto-vehicle-details.p.rapidapi.com';
  
  if (!apiKey) {
    return null;
  }

  // Try standard GET query formats: ?reg_no=, ?rc=, ?registration_number=
  const urlParams = [`reg_no=${encodeURIComponent(regNumber)}`, `rc=${encodeURIComponent(regNumber)}`, `reg_number=${encodeURIComponent(regNumber)}` ];
  
  for (const param of urlParams) {
    try {
      const apiUrl = `https://${apiHost}/?${param}`;
      console.log(`[RapidAPI]: Querying https://${apiHost}/?${param}...`);
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': apiHost,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        continue;
      }

      const json = await response.json();
      const vData = json?.data || json?.result || json?.response || json;

      if (!vData || (json.status && json.status !== 'success' && json.status !== true && json.status !== 200)) {
        continue;
      }

      const vehicleClass = vData.vehicle_category_description || vData.vehicle_category || vData.vehicle_class || vData.body_type || vData.class || '';
      const makerName = vData.makeData?.v_make_name || vData.maker_description || vData.maker_name || vData.maker || vData.brand || '';
      const modelName = vData.maker_model || vData.model_name || vData.model || '';
      const colorName = vData.color || vData.vehicle_color || 'White';
      const yearVal = extractYear(vData.reg_date || vData.registration_date || vData.manufacture_year || vData.manufacturing_date || vData.reg_year || '');
      const brand = cleanBrandName(makerName);
      const isScooterFlag = vData.makeData?.is_scooter === 1 || vData.makeData?.only_scooter === 1;

      if (brand || modelName) {
        console.log(`[RapidAPI SUCCESS]: Found details for ${regNumber} -> ${brand} ${modelName}`);
        return {
          reg_number: regNumber.toUpperCase(),
          brand: brand || 'Vehicle',
          model: modelName || 'Model',
          segment: normalizeCategory(vehicleClass, modelName, brand, isScooterFlag),
          color: colorName,
          year: yearVal || '',
          source: 'vahan-rapidapi',
          not_found: false
        };
      }
    } catch (err) {
      console.warn(`[RapidAPI Warning (${param})]: ${err.message}`);
    }
  }

  return null;
}

/**
 * 3. Custom Indian RTO Provider
 */
async function fetchFromCustomAPI(regNumber) {
  const apiUrl = process.env.RTO_API_URL;
  const apiKey = process.env.RTO_API_KEY;

  if (!apiUrl) {
    return null;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey || ''
      },
      body: JSON.stringify({ vehicle_number: regNumber, rc: regNumber, regNo: regNumber })
    });

    if (!response.ok) {
      throw new Error(`Custom RTO API HTTP ${response.status}`);
    }

    const json = await response.json();
    const data = json.data || json.result || json;

    const maker = data.maker || data.brand || data.maker_description || '';
    const modelName = data.model || data.maker_model || '';
    const color = data.color || 'White';
    const vehicleClass = data.vehicle_category || data.vehicle_class || '';
    const yearVal = extractYear(data.manufacture_year || data.reg_date || data.registration_date || '');
    const brand = cleanBrandName(maker);

    return {
      reg_number: regNumber.toUpperCase(),
      brand: brand || 'Vehicle',
      model: modelName || 'Model',
      segment: normalizeCategory(vehicleClass, modelName, brand),
      color: color,
      year: yearVal || '',
      source: 'custom-rto-api',
      not_found: false
    };
  } catch (err) {
    console.warn(`[Custom RTO API Warning]: ${err.message}`);
    return null;
  }
}

/**
 * 4. APISetu Official Govt MoRTH API
 */
async function fetchFromAPISetu(regNumber) {
  const apiKey = process.env.APISETU_API_KEY;
  const clientId = process.env.APISETU_CLIENT_ID;
  if (!apiKey || !clientId) {
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
    const yearVal = extractYear(data.regDate || data.manufactureYear || '');
    const brand = cleanBrandName(maker);

    return {
      reg_number: regNumber.toUpperCase(),
      brand: brand || 'Vehicle',
      model: modelName || 'Model',
      segment: normalizeCategory(vehicleClass, modelName, brand),
      color: color,
      year: yearVal || '',
      source: 'apisetu-morth',
      not_found: false
    };
  } catch (err) {
    console.warn(`[APISetu Warning]: ${err.message}`);
    return null;
  }
}

/**
 * Master Vehicle Lookup Function
 */
async function lookupVehicle(regNumber) {
  const method = (process.env.LOOKUP_METHOD || 'sandbox').toLowerCase();
  console.log(`[RTO Lookup]: Requesting ${regNumber} via mode [${method}]...`);

  // 1. Primary method execution
  if (method === 'sandbox') {
    const res = await fetchFromSandbox(regNumber);
    if (res && !res.not_found) return res;
  } else if (method === 'rapidapi') {
    const res = await fetchFromRapidAPI(regNumber);
    if (res && !res.not_found) return res;
  } else if (method === 'custom_api') {
    const res = await fetchFromCustomAPI(regNumber);
    if (res && !res.not_found) return res;
  } else if (method === 'apisetu') {
    const res = await fetchFromAPISetu(regNumber);
    if (res && !res.not_found) return res;
  }

  // 2. Fallbacks
  if (method !== 'sandbox' && process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET) {
    console.log('[RTO Lookup]: Trying Sandbox.co.in fallback...');
    const res = await fetchFromSandbox(regNumber);
    if (res && !res.not_found) return res;
  }

  if (method !== 'rapidapi' && process.env.RAPIDAPI_KEY) {
    console.log('[RTO Lookup]: Trying RapidAPI fallback...');
    const res = await fetchFromRapidAPI(regNumber);
    if (res && !res.not_found) return res;
  }

  // 3. Free Puppeteer Scraper Fallback
  console.log(`[RTO Lookup]: Querying Puppeteer scraper fallback for ${regNumber}...`);
  try {
    const scraped = await scrapeVehicleDetails(regNumber);
    if (scraped && !scraped.not_found && (scraped.brand || scraped.model)) {
      return scraped;
    }
  } catch (err) {
    console.warn(`[Puppeteer Scraper Warning]: ${err.message}`);
  }

  // 4. Graceful Manual Entry Fallback
  return {
    reg_number: regNumber.toUpperCase(),
    brand: '',
    model: '',
    segment: 'hatchback',
    color: '',
    year: '',
    source: 'manual-entry',
    not_found: true
  };
}

module.exports = { lookupVehicle, normalizeCategory, cleanBrandName };
