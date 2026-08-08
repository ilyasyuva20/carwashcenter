/**
 * Free Puppeteer-based RTO Vehicle Scraper.
 *
 * Launches a headless Chrome browser to query public vehicle portals
 * for Brand, Model, Category, and Color without requiring paid API tokens.
 *
 * Note: Web portals occasionally update their selectors or add CAPTCHA security,
 * so this module includes a graceful fallback to manual entry.
 */

const puppeteer = require('puppeteer');

// Helper to map scraped vehicle category string to internal segment
function normalizeCategory(vehicleClass = '', modelName = '', brandName = '') {
  const cls = (vehicleClass || '').toUpperCase();
  const mdl = (modelName || '').toUpperCase();
  const brd = (brandName || '').toUpperCase();

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
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Scrape vehicle details using Puppeteer headless browser
 */
async function scrapeVehicleDetails(regNumber) {
  let browser = null;
  const cleanReg = regNumber.toUpperCase().replace(/\s+/g, '');

  try {
    console.log(`[Puppeteer Scraper]: Searching for ${cleanReg}...`);
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(15000);

    // Target a fast public vehicle information portal
    const searchUrl = `https://vahaninfo.com/vehicle-details/${cleanReg}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

    // Evaluate scraped fields from page structure
    const details = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : '';
      };

      return {
        brand: getText('.maker-name, .brand, td:contains("Maker") + td, .vehicle-maker') || '',
        model: getText('.model-name, .model, td:contains("Model") + td, .vehicle-model') || '',
        vehicleClass: getText('.vehicle-class, td:contains("Class") + td') || '',
        color: getText('.vehicle-color, td:contains("Color") + td') || ''
      };
    });

    await browser.close();
    browser = null;

    if (details.brand || details.model) {
      const brand = cleanBrandName(details.brand);
      return {
        reg_number: cleanReg,
        brand: brand || 'Vehicle',
        model: details.model || 'Model',
        segment: normalizeCategory(details.vehicleClass, details.model, brand),
        color: details.color || 'White',
        source: 'puppeteer-scraper',
        not_found: false
      };
    }
  } catch (err) {
    console.warn(`[Puppeteer Scraper Warning]: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // Graceful fallback if scraping target is protected by Cloudflare/Captcha
  return {
    reg_number: cleanReg,
    brand: '',
    model: '',
    segment: 'hatchback',
    color: '',
    source: 'manual-entry',
    not_found: true
  };
}

module.exports = { scrapeVehicleDetails };
