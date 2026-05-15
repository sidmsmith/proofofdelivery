// Proof of Delivery App - Main Script
const orgInput = document.getElementById('org');
const authSection = document.getElementById('authSection');
const mainUI = document.getElementById('mainUI');
const barcodeInput = document.getElementById('barcodeInput');
const cameraBtn = document.getElementById('cameraBtn');
const statusEl = document.getElementById('status');
const shipmentInfo = document.getElementById('shipmentInfo');
const shipmentIdField = document.getElementById('shipmentId');
const carrierField = document.getElementById('carrier');
const trailerField = document.getElementById('trailer');
const billOfLadingField = document.getElementById('billOfLading');
const driverField = document.getElementById('driver');
const cameraModal = document.getElementById('cameraModal');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const cameraViewport = document.getElementById('cameraViewport');
const confirmPickupBtn = document.getElementById('confirmPickupBtn');
const clearSignatureBtn = document.getElementById('clearSignatureBtn');
const authStatusEl = document.getElementById('authStatus');
const themeSelectorBtn = document.getElementById('themeSelectorBtn');
const themeModal = document.getElementById('themeModal');
const themeList = document.getElementById('themeList');
const conditionModal = document.getElementById('conditionModal');
const conditionList = document.getElementById('conditionList');
const conditionLoading = document.getElementById('conditionLoading');
const conditionCancelBtn = document.getElementById('conditionCancelBtn');
const conditionApplyBtn = document.getElementById('conditionApplyBtn');
const modalBackdrop = document.getElementById('modalBackdrop');
const errorModal = document.getElementById('errorModal');
const errorModalMessage = document.getElementById('errorModalMessage');
const errorModalCloseBtn = document.getElementById('errorModalCloseBtn');
const cardsSection = document.getElementById('cardsSection');
const pickupCard = document.getElementById('pickupCard');
const deliveryCard = document.getElementById('deliveryCard');
const backToCardsBtn = document.getElementById('backToCardsBtn');
const stopsSection = document.getElementById('stopsSection');
const backFromStopsBtn = document.getElementById('backFromStopsBtn');
const stopsEmpty = document.getElementById('stopsEmpty');
const stopCards = document.getElementById('stopCards');
const deliverySection = document.getElementById('deliverySection');
const backFromDeliveryBtn = document.getElementById('backFromDeliveryBtn');
const deliveryLoading = document.getElementById('deliveryLoading');
const deliveryEmpty = document.getElementById('deliveryEmpty');
const olpnCards = document.getElementById('olpnCards');
const olpnDetailSection = document.getElementById('olpnDetailSection');
const backFromOlpnDetailBtn = document.getElementById('backFromOlpnDetailBtn');
const detailOlpnId = document.getElementById('detailOlpnId');
const detailStatus = document.getElementById('detailStatus');
const detailContainerType = document.getElementById('detailContainerType');
const detailContainerSize = document.getElementById('detailContainerSize');
const detailEstimatedVolume = document.getElementById('detailEstimatedVolume');
const detailEstimatedWeight = document.getElementById('detailEstimatedWeight');
const detailConditionCodes = document.getElementById('detailConditionCodes');
const updateConditionBtn = document.getElementById('updateConditionBtn');
const deliverBtn = document.getElementById('deliverBtn');
const photoBtn = document.getElementById('photoBtn');
const photoModal = document.getElementById('photoModal');
const closePhotoBtn = document.getElementById('closePhotoBtn');
const capturePhotoBtn = document.getElementById('capturePhotoBtn');
const retakePhotoBtn = document.getElementById('retakePhotoBtn');
const uploadPhotoBtn = document.getElementById('uploadPhotoBtn');
const photoVideo = document.getElementById('photoVideo');
const photoCanvas = document.getElementById('photoCanvas');
const photoPreview = document.getElementById('photoPreview');

let token = null;
let currentOrg = null; // Store org after authentication
let signaturePad = null;
let currentShipmentId = null;
let shipmentStops = [];
let selectedStopId = null;
let selectedStopFacilityName = null;
let deliveryReachedViaStops = false; // True when user entered Delivery by selecting a Stop card (vs bypass)
let selectedOlpnContext = null;
let conditionCodesCache = null;
let selectedConditionCode = null;
let photoStream = null;
let capturedPhotoDataUrl = null;

// Barcode/QR scanning (camera) - ZXing (browser layer / pure JS)
let scannerRunning = false;
let scannerStopPromise = null;
let cameraStream = null;
let cameraVideoEl = null;

let zxingReader = null;
let zxingControls = null;
let zxingDecodeActive = false;
let zxingCallbackSeen = false;
let scannerBackend = null; // 'zxing' | 'quagga'
let scannerFallbackTimer = null;
let quaggaDetectedHandler = null;
let quaggaRunning = false;
let lastScanTime = 0;
let lastScannedCode = '';
let scanCount = 0;
const SCAN_DEBOUNCE_MS = 500; // Prevent rapid successive scans (500ms)
const MIN_CONSISTENT_SCANS = 3; // Require same code detected 3 times before accepting

let cameraModalHistoryState = null; // Track if we pushed a history state for camera modal
const facilityDetailsCache = new Map(); // FacilityId -> Promise<facilityRecord|null>
const stopDeliveredCache = new Map(); // StopId -> Promise<boolean>

// Scanner debug logging (enable with ?scannerDebug=Y)
const SCANNER_DEBUG_ENABLED = (() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const v = (p.get('scannerDebug') || p.get('ScannerDebug') || '').trim().toUpperCase();
    return v === 'Y' || v === 'YES' || v === '1' || v === 'TRUE';
  } catch {
    return false;
  }
})();

function scannerDebug(...args) {
  if (!SCANNER_DEBUG_ENABLED) return;
  // eslint-disable-next-line no-console
  console.log('[scanner]', ...args);
}

function clearScannerFallbackTimer() {
  if (scannerFallbackTimer) {
    try {
      clearTimeout(scannerFallbackTimer);
    } catch {
      // ignore
    }
    scannerFallbackTimer = null;
  }
}

function scheduleScannerFallbackToQuagga() {
  clearScannerFallbackTimer();
  // If ZXing hasn't produced any successful decodes quickly, switch to Quagga2 (1D optimized).
  scannerFallbackTimer = setTimeout(() => {
    if (!scannerRunning || !zxingDecodeActive) return;
    const decodeCount = Number(window.__scannerDecodeCount || 0);
    if (decodeCount > 0) return;
    scannerDebug('fallback: switching to Quagga2 (no successful ZXing decodes)');
    switchToQuaggaScanner();
  }, 3500);
}

function normalizeCandidateCode(rawText) {
  const parsed = extractShipmentIdFromScannedText(rawText);
  const code = String(parsed.shipmentId || '').trim();
  return { parsed, code };
}

function applyStableScanAndMaybeAccept(code, inferredSource) {
  const now = Date.now();
  if (!code) return false;

  // Avoid common false positives where only a short numeric fragment is read.
  if (/^[0-9]+$/.test(code) && code.length < 8) return false;

  if (now - lastScanTime < SCAN_DEBOUNCE_MS) return false;

  if (code === lastScannedCode) scanCount++;
  else {
    scanCount = 1;
    lastScannedCode = code;
  }
  lastScanTime = now;

  const scannerStatus = document.getElementById('scannerStatus');
  if (scannerStatus) {
    scannerStatus.textContent =
      scanCount >= MIN_CONSISTENT_SCANS
        ? `Scanned: ${code}`
        : `Detected: ${code} (${scanCount}/${MIN_CONSISTENT_SCANS}) - Keep steady...`;
  }

  if (scanCount >= MIN_CONSISTENT_SCANS) {
    clearScannerFallbackTimer();
    stopBarcodeScanner().finally(() => processScannedCode(code, inferredSource));
    return true;
  }

  return false;
}

function stopQuaggaScanner() {
  const Q = window.Quagga;
  quaggaRunning = false;
  if (!Q) return;

  try {
    if (quaggaDetectedHandler && typeof Q.offDetected === 'function') {
      Q.offDetected(quaggaDetectedHandler);
    }
  } catch {
    // ignore
  }
  quaggaDetectedHandler = null;

  try {
    if (typeof Q.stop === 'function') Q.stop();
  } catch {
    // ignore
  }
}

function startQuaggaScanner() {
  const scannerStatus = document.getElementById('scannerStatus');
  const interactiveElement = document.getElementById('interactive');
  const Q = window.Quagga;

  if (!interactiveElement) {
    showStatus('Error: Scanner container not found', 'error');
    return;
  }
  if (!Q || typeof Q.init !== 'function') {
    showStatus('Fallback scanner library not loaded. Please refresh and try again.', 'error');
    if (scannerStatus) scannerStatus.textContent = 'Error: fallback scanner not loaded';
    return;
  }

  scannerBackend = 'quagga';
  quaggaRunning = true;
  scannerDebug('starting Quagga2');
  if (scannerStatus) scannerStatus.textContent = 'Starting alternate scanner...';

  // Clear existing DOM
  interactiveElement.innerHTML = '';

  // Reduce CPU for mobile; cap workers.
  const workers = (() => {
    const hc = Number(navigator.hardwareConcurrency || 2);
    if (!Number.isFinite(hc) || hc <= 0) return 2;
    return Math.min(4, Math.max(1, hc - 1));
  })();

  const config = {
    inputStream: {
      name: 'Live',
      type: 'LiveStream',
      target: interactiveElement,
      constraints: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      // Match the on-screen scanning frame (wide-ish area works better for 1D)
      area: { top: '20%', right: '10%', left: '10%', bottom: '20%' }
    },
    locator: {
      patchSize: 'medium',
      halfSample: true
    },
    locate: true,
    numOfWorkers: workers,
    frequency: 10,
    decoder: {
      readers: [
        'code_128_reader',
        'code_39_reader',
        'ean_reader',
        'ean_8_reader',
        'upc_reader',
        'upc_e_reader',
        'i2of5_reader'
      ]
    }
  };

  Q.init(config, (err) => {
    if (err) {
      console.error('Quagga init failed:', err);
      quaggaRunning = false;
      if (scannerStatus) scannerStatus.textContent = `Error: ${err?.message || 'Scanner init failed'}`;
      showStatus(`Error: ${err?.message || 'Scanner init failed'}`, 'error');
      return;
    }

    try {
      Q.start();
    } catch (e) {
      console.error('Quagga start failed:', e);
      quaggaRunning = false;
      if (scannerStatus) scannerStatus.textContent = `Error: ${e?.message || 'Scanner start failed'}`;
      showStatus(`Error: ${e?.message || 'Scanner start failed'}`, 'error');
      return;
    }

    if (scannerStatus) scannerStatus.textContent = 'Camera ready. Point at barcode...';
    showStatus('Camera ready. Point at barcode or QR code to scan.', 'info');
  });

  quaggaDetectedHandler = (result) => {
    if (!scannerRunning || !quaggaRunning) return;
    const raw = result?.codeResult?.code || '';
    if (!raw) return;

    if (SCANNER_DEBUG_ENABLED) window.__scannerDecodeCount = (window.__scannerDecodeCount || 0) + 1;
    const { parsed, code } = normalizeCandidateCode(raw);
    scannerDebug('decoded', {
      backend: 'quagga',
      raw: String(parsed.raw || '').slice(0, 200),
      shipmentId: code,
      inferredSource: parsed.inferredSource
    });

    if (!code) return;
    applyStableScanAndMaybeAccept(code, parsed.inferredSource);
  };

  try {
    Q.onDetected(quaggaDetectedHandler);
  } catch {
    // ignore
  }
}

function switchToQuaggaScanner() {
  // Prevent repeated switches.
  if (scannerBackend === 'quagga') return;
  clearScannerFallbackTimer();

  // Stop ZXing (releases camera) then start Quagga.
  stopBarcodeScanner()
    .catch(() => {})
    .finally(() => {
      // Keep modal open, start alternate backend immediately.
      scannerRunning = true;
      zxingDecodeActive = false;
      zxingCallbackSeen = false;
      startQuaggaScanner();
    });
}

function extractShipmentIdFromScannedText(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return { raw: '', shipmentId: '', inferredSource: 'camera' };

  // Common normalizations across barcode engines
  const normalized = raw.replace(/[–—−]/g, '-').replace(/^\*+|\*+$/g, '').trim();
  const looksUrlLike =
    /^https?:\/\//i.test(normalized) ||
    normalized.startsWith('?') ||
    (normalized.includes('=') && (normalized.includes('&') || normalized.includes('?')));

  const isValidShipmentId = (v) => {
    const s = String(v || '').trim();
    if (!s) return false;
    // Shipment IDs in this app are expected to be URL-safe alphanum with a few separators.
    // (Keeps us from accepting random QR payload fragments.)
    return /^[A-Za-z0-9][A-Za-z0-9\-_:]{2,}$/.test(s);
  };

  // If it already looks like a shipment id, accept immediately.
  if (!looksUrlLike && isValidShipmentId(normalized)) {
    return { raw, shipmentId: normalized, inferredSource: 'camera' };
  }

  const getShipmentFromParams = (params) => {
    if (!params) return '';
    const keys = ['ShipmentId', 'Shipment', 'shipmentId', 'shipment', 'SHIPMENTID', 'SHIPMENT'];
    for (const k of keys) {
      const v = params.get(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return '';
  };

  // 1) Full URL payload
  try {
    const u = new URL(normalized);
    const fromUrl = getShipmentFromParams(u.searchParams);
    if (isValidShipmentId(fromUrl)) return { raw, shipmentId: fromUrl, inferredSource: 'QR Code' };
  } catch {
    // ignore
  }

  // 2) Query-string payloads (with/without leading '?')
  try {
    const q = normalized.startsWith('?') ? normalized.slice(1) : normalized;
    // If there is a '?', only parse the part after it.
    const qs = q.includes('?') ? q.split('?').slice(1).join('?') : q;
    if (qs.includes('=')) {
      const params = new URLSearchParams(qs);
      const fromQs = getShipmentFromParams(params);
      if (isValidShipmentId(fromQs)) return { raw, shipmentId: fromQs, inferredSource: 'QR Code' };
    }
  } catch {
    // ignore
  }

  // 3) Regex fallback (handles slightly malformed query strings)
  const m = normalized.match(/(?:^|[?&])Shipment(?:Id)?=([^&#]+)/i);
  if (m && m[1]) {
    try {
      const decoded = decodeURIComponent(String(m[1]).trim());
      if (isValidShipmentId(decoded)) return { raw, shipmentId: decoded, inferredSource: 'QR Code' };
    } catch {
      const v = String(m[1]).trim();
      if (isValidShipmentId(v)) return { raw, shipmentId: v, inferredSource: 'QR Code' };
    }
  }

  // 4) Common label pattern fallback (e.g., "Shipment SHI000001103")
  // If the scanned payload contains a recognizable ShipmentId token, extract it.
  const shi = normalized.match(/\bSHI[0-9]{6,}\b/i);
  if (shi && shi[0]) {
    const v = String(shi[0]).trim();
    if (isValidShipmentId(v)) return { raw, shipmentId: v, inferredSource: looksUrlLike ? 'QR Code' : 'camera' };
  }

  // Nothing extractable that looks like a shipment id.
  return { raw, shipmentId: '', inferredSource: looksUrlLike ? 'QR Code' : 'camera' };
}

// ===== SESSION TRACKING =====
const SESSION_STORAGE_KEY = 'proofofdelivery_session';
let sessionId = null;
let pageLoadTime = null;
let authAttemptCount = 0;
let firstAuthSuccess = true;
let signatureClearCount = 0;

// Initialize session on page load
(function initSession() {
  pageLoadTime = Date.now();
  
  // Get or create session ID
  sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionId) {
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  
  // Check if returning user
  const hasSavedPreferences = localStorage.getItem('selectedTheme') !== null;
  
  // Store for metadata collection
  window._appSession = {
    sessionId,
    pageLoadTime,
    hasSavedPreferences
  };
})();

// ===== GENERIC METADATA COLLECTION (Reusable across all apps) =====
function getCommonMetadata(additionalMetadata = {}) {
  const now = Date.now();
  const timeOnPage = pageLoadTime ? Math.floor((now - pageLoadTime) / 1000) : 0;
  
  // Parse user agent
  const ua = navigator.userAgent;
  const browserInfo = parseUserAgent(ua);
  
  // Get screen info
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const screenResolution = `${screenWidth}x${screenHeight}`;
  
  // Get URL parameters
  const urlParamsObj = {};
  const currentUrlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of currentUrlParams.entries()) {
    urlParamsObj[key] = value;
  }
  
  // Get theme
  const currentTheme = localStorage.getItem('selectedTheme') || 'default';
  
  // Check for auto-authentication via URL params
  const urlOrg = urlParamsObj.Organization || null;
  
  // Build common metadata
  const commonMetadata = {
    // Category 1: User/Browser Information
    user_agent: ua,
    browser_name: browserInfo.name,
    browser_version: browserInfo.version,
    device_type: getDeviceType(),
    os_name: browserInfo.os,
    os_version: browserInfo.osVersion,
    screen_resolution: screenResolution,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language || navigator.userLanguage,
    
    // Category 2: Session & Context
    session_id: sessionId,
    page_load_time: pageLoadTime ? new Date(pageLoadTime).toISOString() : null,
    time_on_page: timeOnPage,
    referrer: document.referrer || null,
    url_params: Object.keys(urlParamsObj).length > 0 ? urlParamsObj : null,
    auto_authenticated: !!urlOrg,
    
    // Category 3: App State & Preferences
    theme: currentTheme,
    has_saved_preferences: window._appSession?.hasSavedPreferences || false,
    
    // Category 4: Authentication Context (will be overridden by event-specific data)
    auth_method: urlOrg ? 'url_param' : 'manual',
    auth_attempt_count: authAttemptCount,
    first_auth_success: firstAuthSuccess,
    
    // Category 7: Error & Debugging (will be populated if error occurs)
    // error_code, error_message, stack_trace, api_error_details - added per event
    
    // Category 8: Cross-App Integration
    source_app: urlOrg ? 'cross_app' : null,
    integration_type: urlOrg ? 'url_params' : 'direct',
    
    // Category 10: Geographic/Network
    request_origin: window.location.origin,
    
    // Merge any additional metadata
    ...additionalMetadata
  };
  
  return commonMetadata;
}

// Helper: Parse user agent
function parseUserAgent(ua) {
  let name = 'Unknown';
  let version = 'Unknown';
  let os = 'Unknown';
  let osVersion = 'Unknown';
  
  // Browser detection
  if (ua.includes('Chrome') && !ua.includes('Edg')) {
    name = 'Chrome';
    const match = ua.match(/Chrome\/([\d.]+)/);
    version = match ? match[1] : 'Unknown';
  } else if (ua.includes('Firefox')) {
    name = 'Firefox';
    const match = ua.match(/Firefox\/([\d.]+)/);
    version = match ? match[1] : 'Unknown';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    name = 'Safari';
    const match = ua.match(/Version\/([\d.]+)/);
    version = match ? match[1] : 'Unknown';
  } else if (ua.includes('Edg')) {
    name = 'Edge';
    const match = ua.match(/Edg\/([\d.]+)/);
    version = match ? match[1] : 'Unknown';
  }
  
  // OS detection
  if (ua.includes('Windows')) {
    os = 'Windows';
    const match = ua.match(/Windows NT ([\d.]+)/);
    if (match) {
      const ntVersion = match[1];
      const versionMap = {
        '10.0': '10/11',
        '6.3': '8.1',
        '6.2': '8',
        '6.1': '7'
      };
      osVersion = versionMap[ntVersion] || ntVersion;
    }
  } else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) {
    os = 'macOS';
    const match = ua.match(/Mac OS X ([\d_]+)/);
    if (match) {
      osVersion = match[1].replace(/_/g, '.');
    }
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  } else if (ua.includes('Android')) {
    os = 'Android';
    const match = ua.match(/Android ([\d.]+)/);
    osVersion = match ? match[1] : 'Unknown';
  } else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os = 'iOS';
    const match = ua.match(/OS ([\d_]+)/);
    if (match) {
      osVersion = match[1].replace(/_/g, '.');
    }
  }
  
  return { name, version, os, osVersion };
}

// Helper: Get device type
function getDeviceType() {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|android|blackberry|opera|mini|windows\sce|palm|smartphone|iemobile/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

// Usage tracking (dashboard ingest → Neon)
async function trackEvent(eventName, metadata = {}) {
  try {
    const fullMetadata = getCommonMetadata(metadata);
    await apiCall('usage-track', {
      event_name: eventName,
      metadata: fullMetadata
    });
  } catch (error) {
    console.warn('[usage] Failed to track event:', error);
  }
}

// Initialize Signature Pad
function initSignaturePad() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) {
    console.warn('Signature canvas not found');
    return;
  }
  
  // Ensure signature section is visible
  const signatureSection = document.querySelector('.signature-section');
  if (!signatureSection || signatureSection.style.display === 'none') {
    console.warn('Signature section is not visible');
    return;
  }
  
  // Clear existing signature pad if it exists
  if (signaturePad) {
    signaturePad.clear();
    signaturePad.off(); // Remove event listeners
  }
  
  // Get computed style to get actual dimensions
  const computedStyle = window.getComputedStyle(canvas);
  const width = parseInt(computedStyle.width, 10) || canvas.offsetWidth || 400;
  const height = parseInt(computedStyle.height, 10) || canvas.offsetHeight || 200;
  
  // Adjust canvas size for high DPI displays
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  
  // Create signature pad
  signaturePad = new SignaturePad(canvas, {
    backgroundColor: '#ffffff',
    penColor: '#000000',
    minWidth: 1,
    maxWidth: 3,
    throttle: 16
  });
  
  // Handle window resize - save and restore signature to prevent clearing on mobile keyboard
  let resizeTimeout = null;
  function resizeCanvas() {
    // Debounce resize events to avoid multiple calls
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
    
    resizeTimeout = setTimeout(() => {
      if (!signaturePad || signaturePad.isEmpty()) {
        // No signature to save, just resize
        const computedStyle = window.getComputedStyle(canvas);
        const newWidth = parseInt(computedStyle.width, 10) || canvas.offsetWidth || 400;
        const newHeight = parseInt(computedStyle.height, 10) || canvas.offsetHeight || 200;
        
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = newWidth * ratio;
        canvas.height = newHeight * ratio;
        canvas.style.width = newWidth + 'px';
        canvas.style.height = newHeight + 'px';
        
        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        return;
      }
      
      // Save signature data before resizing
      const signatureData = signaturePad.toDataURL('image/png');
      
      // Get new dimensions
      const computedStyle = window.getComputedStyle(canvas);
      const newWidth = parseInt(computedStyle.width, 10) || canvas.offsetWidth || 400;
      const newHeight = parseInt(computedStyle.height, 10) || canvas.offsetHeight || 200;
      
      // Check if dimensions actually changed significantly (more than 10px difference)
      const currentWidth = canvas.offsetWidth || parseInt(computedStyle.width, 10) || 400;
      const currentHeight = canvas.offsetHeight || parseInt(computedStyle.height, 10) || 200;
      
      const widthDiff = Math.abs(newWidth - currentWidth);
      const heightDiff = Math.abs(newHeight - currentHeight);
      
      // Only resize if dimensions changed significantly (not just keyboard appearing)
      if (widthDiff < 10 && heightDiff < 10) {
        return; // Skip resize for minor changes (like keyboard appearing)
      }
      
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = newWidth * ratio;
      canvas.height = newHeight * ratio;
      canvas.style.width = newWidth + 'px';
      canvas.style.height = newHeight + 'px';
      
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      
      // Restore signature after resize
      const img = new Image();
      img.onload = () => {
        // Clear and redraw the signature on the resized canvas
        ctx.clearRect(0, 0, newWidth, newHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, newWidth, newHeight);
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        // Update signature pad's internal state by loading the data URL
        if (signaturePad && typeof signaturePad.fromDataURL === 'function') {
          signaturePad.fromDataURL(signatureData);
        }
      };
      img.src = signatureData;
    }, 150); // Debounce resize events by 150ms
  }
  
  window.addEventListener('resize', resizeCanvas);
  
  console.log('Signature pad initialized', { width, height, ratio });
}

// Show status message
function showStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
}

function hideStatus() {
  statusEl.style.display = 'none';
}

// Show error modal (for critical errors that need user attention)
function showErrorModal(message) {
  if (errorModal && errorModalMessage) {
    errorModalMessage.textContent = message;
    errorModal.removeAttribute('hidden');
  } else {
    // Fallback to regular status if modal elements not found
    showStatus(message, 'error');
  }
}

// Hide error modal
function hideErrorModal() {
  if (errorModal) {
    errorModal.setAttribute('hidden', '');
  }
}

// Show auth status message (in auth section)
function showAuthStatus(message, type = 'info') {
  if (authStatusEl) {
    authStatusEl.textContent = message;
    authStatusEl.className = `status ${type}`;
    authStatusEl.style.display = 'block';
  }
}

function hideAuthStatus() {
  if (authStatusEl) {
    authStatusEl.style.display = 'none';
  }
}

// API call helper
async function apiCall(action, data = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  
  return fetch('/api/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...data })
  }).then(r => r.json());
}

// Auto-authenticate from URL parameters (Organization/ORG, ShipmentId/Shipment) – same as driver_pickup
function checkAutoAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlOrg = urlParams.get('Organization') || urlParams.get('ORG');
  const urlShipmentId = urlParams.get('ShipmentId') || urlParams.get('Shipment');
  
  // Store ShipmentId from URL for later use (after authentication)
  if (urlShipmentId && urlShipmentId.trim()) {
    window.urlShipmentId = urlShipmentId.trim();
  }
  
  // Always require authentication - if Organization/ORG is provided, auto-authenticate
  if (urlOrg && urlOrg.trim()) {
    orgInput.value = urlOrg.trim();
    authenticate();
  }
  // If no Organization in URL, user will need to authenticate manually
}

// Authenticate
async function authenticate() {
  const org = orgInput.value.trim();
  if (!org) {
    showAuthStatus('ORG required', 'error');
    return;
  }
  
  // Increment auth attempt count
  authAttemptCount++;
  const authStartTime = Date.now();
  
  // Track auth attempt
  trackEvent('auth_attempt', {
    org: org || 'unknown',
    auth_attempt_count: authAttemptCount
  });
  
  showAuthStatus('Authenticating...', 'info');
  
  try {
    const res = await apiCall('auth', { org });
    const authDuration = Date.now() - authStartTime;
    
    if (!res.success) {
      showAuthStatus('Authentication Failed!', 'error');
      mainUI.style.display = 'none';
      
      // Track auth failure
      trackEvent('auth_failed', {
        org: org || 'unknown',
        error: res.error || 'Auth failed',
        error_message: res.error || 'Auth failed',
        auth_attempt_count: authAttemptCount,
        auth_duration_ms: authDuration,
        token_received: false
      });
      firstAuthSuccess = false;
      return;
    }
    
    token = res.token;
    currentOrg = org.toUpperCase(); // Store org in uppercase for API consistency
    hideAuthStatus(); // Hide auth status on success
    authSection.style.display = 'none';
    mainUI.style.display = 'block';
    
    // Track auth success
    trackEvent('auth_success', {
      org: org,
      auth_attempt_count: authAttemptCount,
      auth_duration_ms: authDuration,
      token_received: true,
      first_auth_success: firstAuthSuccess
    });
    
    // Reset for next session (if they log out and back in)
    firstAuthSuccess = false;
    
    // If ShipmentId was provided in URL, automatically validate it
    if (window.urlShipmentId) {
      // Pre-populate the barcode input field with the ShipmentId from URL
      barcodeInput.value = window.urlShipmentId;
      
      // Small delay to ensure UI is ready
      setTimeout(() => {
        validateBarcode(window.urlShipmentId);
        // Clear the stored value so we don't re-validate on subsequent auths
        window.urlShipmentId = null;
      }, 300);
    }
    
    // Don't initialize signature pad here - it will be initialized when signature section is shown
  } catch (error) {
    console.error('Authentication error:', error);
    showAuthStatus('Authentication Failed!', 'error');
    mainUI.style.display = 'none';
    
    // Track auth error
    trackEvent('auth_failed', {
      org: org || 'unknown',
      error: error.message || 'Unknown error',
      error_message: error.message || 'Unknown error',
      auth_attempt_count: authAttemptCount,
      auth_duration_ms: Date.now() - authStartTime,
      token_received: false
    });
    firstAuthSuccess = false;
  }
}

// Validate barcode
async function validateBarcode(shipmentId) {
  if (!shipmentId || !shipmentId.trim()) {
    showStatus('Please enter or scan a barcode', 'error');
    return;
  }
  
  // Reset any secondary screens before validating a new shipment
  if (stopsSection) stopsSection.style.display = 'none';
  if (stopsEmpty) stopsEmpty.style.display = 'none';
  if (stopCards) stopCards.innerHTML = '';
  if (deliverySection) deliverySection.style.display = 'none';
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';
  if (deliveryLoading) deliveryLoading.style.display = 'none';
  if (deliveryEmpty) deliveryEmpty.style.display = 'none';
  if (olpnCards) olpnCards.innerHTML = '';
  shipmentInfo.style.display = 'none';
  const signatureSection = document.querySelector('.signature-section');
  if (signatureSection) signatureSection.style.display = 'none';

  showStatus('Validating barcode...', 'info');
  
  // Determine validation method (manual entry vs camera scan)
  const validationMethod = window._lastScanSource || 'manual_entry';
  const validationStartTime = Date.now();
  
  // Track barcode validation attempt with proof of delivery specific metadata
  trackEvent('barcode_validation_attempt', {
    org: currentOrg || 'unknown',
    barcode: shipmentId.trim(),
    shipment_id: shipmentId.trim(),
    barcode_validation_method: validationMethod,
    code_length: String(shipmentId.trim().length)
  });
  
  const apiStartTime = Date.now();
  const res = await apiCall('validate_barcode', { 
    org: currentOrg,
    shipmentId: shipmentId.trim() 
  });
  const apiResponseTime = Date.now() - apiStartTime;
  const validationDuration = Date.now() - validationStartTime;
  
  if (!res.success) {
    // Show same error message as before
    showStatus(res.error || 'Barcode validation failed', 'error');
    shipmentInfo.style.display = 'none';
    if (cardsSection) cardsSection.style.display = 'none';
    
    // Hide signature section on validation failure
    if (signatureSection) signatureSection.style.display = 'none';
    
    // Track validation failure with proof of delivery specific metadata
    trackEvent('barcode_validation_failed', {
      org: currentOrg || 'unknown',
      barcode: shipmentId.trim(),
      shipment_id: shipmentId.trim(),
      barcode_validation_method: validationMethod,
      error: res.error || 'Validation failed',
      error_message: res.error || 'Validation failed',
      validation_duration_ms: validationDuration,
      api_response_time_ms: apiResponseTime,
      shipment_found: false
    });
    
    // Ensure barcode input is visible and ready for user to enter new ShipmentId
    // (This handles the case where ShipmentId came from URL and was invalid)
    barcodeInput.focus();
    
    return;
  }
  
  // Populate shipment information
  currentShipmentId = res.shipmentId;
  shipmentStops = Array.isArray(res.stops) ? res.stops : [];
  selectedStopId = null;
  selectedStopFacilityName = null;
  shipmentIdField.value = res.shipmentId || '';
  carrierField.value = res.assignedCarrierId || '';
  trailerField.value = res.trailerNumber || '';
  billOfLadingField.value = res.billOfLadingNumber || '';
  driverField.value = ''; // Clear driver field
  
  // Show Pickup/Delivery cards (not shipment info yet)
  shipmentInfo.style.display = 'none';
  if (cardsSection) cardsSection.style.display = 'block';
  
  // Track successful validation with proof of delivery specific metadata
  trackEvent('barcode_validated', {
    org: currentOrg || 'unknown',
    barcode: shipmentId.trim(),
    shipment_id: res.shipmentId || shipmentId.trim(),
    carrier_id: res.assignedCarrierId || null,
    trailer_number: res.trailerNumber || null,
    bill_of_lading: res.billOfLadingNumber || null,
    has_bill_of_lading: !!res.billOfLadingNumber,
    barcode_validation_method: validationMethod,
    validation_duration_ms: validationDuration,
    api_response_time_ms: apiResponseTime,
    shipment_found: true
  });
  
  // Clear the scan source after successful validation
  window._lastScanSource = null;
  
  // Keep signature section hidden until user clicks Pickup
  if (signatureSection) signatureSection.style.display = 'none';
  
  // Hide status message on success (UI change is obvious)
  hideStatus();
}

function showPickupScreen() {
  if (cardsSection) cardsSection.style.display = 'none';
  if (stopsSection) stopsSection.style.display = 'none';
  if (deliverySection) deliverySection.style.display = 'none';
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';
  shipmentInfo.style.display = 'block';
  hideStatus();
  const signatureSection = document.querySelector('.signature-section');
  if (signatureSection) {
    signatureSection.style.display = 'block';
    requestAnimationFrame(() => {
      setTimeout(() => initSignaturePad(), 100);
    });
  }
}

function showCardsScreen() {
  shipmentInfo.style.display = 'none';
  if (stopsSection) stopsSection.style.display = 'none';
  if (deliverySection) deliverySection.style.display = 'none';
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';
  const signatureSection = document.querySelector('.signature-section');
  if (signatureSection) signatureSection.style.display = 'none';
  if (signaturePad) signaturePad.clear();
  if (cardsSection) cardsSection.style.display = 'block';

  selectedStopId = null;
  selectedStopFacilityName = null;
  deliveryReachedViaStops = false;

  if (deliveryLoading) deliveryLoading.style.display = 'none';
  if (deliveryEmpty) deliveryEmpty.style.display = 'none';
  if (olpnCards) olpnCards.innerHTML = '';
}

function showStopsScreen() {
  if (!currentShipmentId) {
    showStatus('Validate a shipment first', 'error');
    return;
  }

  hideStatus();
  shipmentInfo.style.display = 'none';
  const signatureSection = document.querySelector('.signature-section');
  if (signatureSection) signatureSection.style.display = 'none';
  if (signaturePad) signaturePad.clear();

  if (cardsSection) cardsSection.style.display = 'none';
  if (stopsSection) stopsSection.style.display = 'block';
  if (deliverySection) deliverySection.style.display = 'none';
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';

  if (stopsEmpty) stopsEmpty.style.display = 'none';
  if (stopCards) stopCards.innerHTML = '';
  deliveryReachedViaStops = false;
  stopDeliveredCache.clear();

  const stops = Array.isArray(shipmentStops) ? shipmentStops : [];
  const dlStops = stops.filter((s) => {
    const action =
      s?.StopActionId?.StopActionId ??
      s?.stopActionId?.StopActionId ??
      s?.stopActionId?.stopActionId ??
      s?.StopAction ??
      s?.stopAction ??
      '';
    return String(action || '').trim().toUpperCase() === 'DL';
  });

  // If there's exactly 1 delivery stop, bypass Stops screen entirely.
  // NOTE (testing): To disable auto-advance again, comment out this block.
  if (dlStops.length === 1) {
    const only = dlStops[0];
    const stopId = only?.StopId ?? only?.stopId ?? '';
    const facilityName = only?.FacilityName ?? only?.facilityName ?? '';
    deliveryReachedViaStops = false;
    showDeliveryOlpnList(stopId, facilityName);
    return;
  }

  if (dlStops.length === 0) {
    if (stopsEmpty) stopsEmpty.style.display = 'block';
    return;
  }

  renderStopCards(dlStops);
}

function getPodStatusFromRecord(record) {
  return (
    record?.Extended?.PODStatus ??
    record?.extended?.PODStatus ??
    record?.PODStatus ??
    record?.podStatus ??
    record?.PodStatus ??
    ''
  );
}

function isDeliveredRecord(record) {
  return String(getPodStatusFromRecord(record) || '').trim().toUpperCase() === 'DELIVERED';
}

async function fetchStopAllDelivered(stopIdRaw) {
  const stopId = String(stopIdRaw || '').trim();
  if (!stopId) return false;
  if (!currentOrg || !currentShipmentId) return false;

  if (stopDeliveredCache.has(stopId)) return stopDeliveredCache.get(stopId);

  const p = apiCall('search_olpns', {
    org: currentOrg,
    shipmentId: currentShipmentId,
    stopId,
    size: 1000
  })
    .then((res) => {
      if (!res?.success) return false;
      const records = Array.isArray(res?.data) ? res.data : [];
      if (records.length === 0) return false;
      return records.every((r) => isDeliveredRecord(r));
    })
    .catch(() => false);

  stopDeliveredCache.set(stopId, p);
  return p;
}

function getStopFacilityName(stop) {
  return stop?.FacilityName ?? stop?.facilityName ?? '';
}

function getStopFacilityId(stop) {
  return stop?.FacilityId ?? stop?.facilityId ?? '';
}

function getStopFacilityAddress(stop) {
  return stop?.FacilityAddress ?? stop?.facilityAddress ?? null;
}

function formatCityState(city, state) {
  const c = String(city || '').trim();
  const s = String(state || '').trim();
  if (!c && !s) return '';
  if (c && s) return `${c}, ${s}`;
  return c || s;
}

function buildStopFacilityDisplay(facilityName, cityState) {
  const name = String(facilityName || '').trim();
  const cs = String(cityState || '').trim();

  // Requirement:
  // - If FacilityName exists => "FacilityName: City, State"
  // - If FacilityName does NOT exist => "City, State"
  if (name) return cs ? `${name}: ${cs}` : name;
  return cs;
}

async function fetchFacilityDetailsById(facilityIdRaw) {
  const facilityId = String(facilityIdRaw || '').trim();
  if (!facilityId) return null;
  if (!currentOrg) return null;

  if (facilityDetailsCache.has(facilityId)) return facilityDetailsCache.get(facilityId);

  const p = apiCall('get_facility', { org: currentOrg, facilityId })
    .then((res) => (res?.success ? res?.data ?? null : null))
    .catch(() => null);

  facilityDetailsCache.set(facilityId, p);
  return p;
}

function renderStopCards(stops) {
  if (!stopCards) return;
  stopCards.innerHTML = '';

  const sorted = [...stops].sort((a, b) => {
    const as = Number(a?.StopSequence ?? 0);
    const bs = Number(b?.StopSequence ?? 0);
    return as - bs;
  });

  sorted.forEach((stop) => {
    const stopId = stop?.StopId ?? stop?.stopId ?? '';
    const facilityName = getStopFacilityName(stop);
    const facilityId = getStopFacilityId(stop);
    const addr = getStopFacilityAddress(stop);
    const cityState = formatCityState(addr?.City ?? addr?.city, addr?.State ?? addr?.state);

    const card = document.createElement('div');
    card.className = 'stop-card';
    card.addEventListener('click', () => {
      deliveryReachedViaStops = true;
      showDeliveryOlpnList(stopId, facilityName);
    });

    const icon = document.createElement('div');
    icon.className = 'stop-icon';
    const setStopIconColor = (colorVar) => {
      icon.innerHTML = `<i class="fas fa-location-dot" style="color: ${colorVar}; font-size: 1.35rem;"></i>`;
    };
    // Default to red until we confirm all oLPNs are delivered for this stop
    setStopIconColor('var(--danger-color)');
    fetchStopAllDelivered(stopId).then((allDelivered) => {
      setStopIconColor(allDelivered ? 'var(--success-color)' : 'var(--danger-color)');
    });

    const textWrap = document.createElement('div');
    textWrap.className = 'stop-text';

    const idEl = document.createElement('div');
    idEl.className = 'stop-id';
    idEl.textContent = String(stopId || '(missing StopId)');

    const facEl = document.createElement('div');
    facEl.className = 'stop-facility';
    facEl.textContent = buildStopFacilityDisplay(facilityName, cityState);

    // If City/State wasn't returned in the shipment stop, look it up from Facility service.
    // (Common when FacilityName is present but Stop.FacilityAddress is null.)
    if (!cityState && facilityId) {
      fetchFacilityDetailsById(facilityId).then((facility) => {
        if (!facility) return;
        const fAddr = facility?.FacilityAddress ?? facility?.facilityAddress ?? null;
        const nextCityState = formatCityState(fAddr?.City ?? fAddr?.city, fAddr?.State ?? fAddr?.state);
        if (!nextCityState) return;
        facEl.textContent = buildStopFacilityDisplay(facilityName, nextCityState);
      });
    }

    textWrap.appendChild(idEl);
    textWrap.appendChild(facEl);

    card.appendChild(icon);
    card.appendChild(textWrap);
    stopCards.appendChild(card);
  });
}

async function showDeliveryOlpnList(stopId, facilityName) {
  if (!currentShipmentId) {
    showStatus('Validate a shipment first', 'error');
    return;
  }
  const stopIdValue = String(stopId || '').trim();
  if (!stopIdValue) {
    showStatus('Missing StopId', 'error');
    return;
  }

  selectedStopId = stopIdValue;
  selectedStopFacilityName = facilityName ? String(facilityName) : null;

  hideStatus();
  shipmentInfo.style.display = 'none';
  const signatureSection = document.querySelector('.signature-section');
  if (signatureSection) signatureSection.style.display = 'none';
  if (signaturePad) signaturePad.clear();

  if (cardsSection) cardsSection.style.display = 'none';
  if (stopsSection) stopsSection.style.display = 'none';
  if (deliverySection) deliverySection.style.display = 'block';
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';

  if (deliveryEmpty) deliveryEmpty.style.display = 'none';
  if (olpnCards) olpnCards.innerHTML = '';
  if (deliveryLoading) deliveryLoading.style.display = 'block';

  // Update empty message text for stop-level search
  if (deliveryEmpty) {
    const p = deliveryEmpty.querySelector('p');
    if (p) p.textContent = 'No OLPNS found for this stop.';
  }

  try {
    const res = await apiCall('search_olpns', {
      org: currentOrg,
      shipmentId: currentShipmentId,
      stopId: stopIdValue
    });

    if (deliveryLoading) deliveryLoading.style.display = 'none';

    if (!res || res.success === false) {
      showStatus(res?.error || 'OLPN search failed', 'error');
      return;
    }

    const records = Array.isArray(res.data) ? res.data : [];
    // Normalize PODCondition casing so detail page renders on first open
    records.forEach((r) => {
      if (r && (r.PODCondition === undefined || r.PODCondition === null || String(r.PODCondition).trim() === '')) {
        const alt =
          r?.Extended?.PODCondition ??
          r?.extended?.PODCondition ??
          r.PodCondition ??
          r.podCondition ??
          r.POD_CONDITION;
        if (alt !== undefined && alt !== null) r.PODCondition = alt;
      }
    });
    window._deliveryOlpns = records;
    if (records.length === 0) {
      if (deliveryEmpty) deliveryEmpty.style.display = 'block';
      return;
    }

    renderOlpnCards(records);
  } catch (e) {
    if (deliveryLoading) deliveryLoading.style.display = 'none';
    showStatus(e?.message || 'OLPN search failed', 'error');
  }
}

function renderOlpnCards(records) {
  if (!olpnCards) return;
  olpnCards.innerHTML = '';

  const list = Array.isArray(records) ? records : [];

  const getOlpnId = (r) =>
    r?.OlpnId ?? r?.olpnId ?? r?.OLPNID ?? r?.OLPN_ID ?? '';

  const getLpnType = (r) =>
    r?.LpnType ?? r?.lpnType ?? r?.LPNTYPE ?? '';

  const getPalletId = (r) =>
    r?.PalletId ?? r?.palletId ?? r?.PALLETID ?? r?.PALLET_ID ?? '';

  const getContainerType = (r) =>
    r?.ContainerTypeId ?? r?.ContainerType ?? r?.containerTypeId ?? r?.containerType ?? '';

  const getStatus = (r) =>
    r?.Extended?.PODStatus ??
    r?.extended?.PODStatus ??
    r?.PODStatus ??
    r?.podStatus ??
    r?.PodStatus ??
    '';

  const isDelivered = (r) => String(getStatus(r)).trim().toUpperCase() === 'DELIVERED';
  const isPalletRecord = (r) => {
    const t = String(getLpnType(r) || '').trim().toUpperCase();
    if (t === 'PALLET') return true;
    // Fallbacks (some tenants may not return LpnType consistently)
    const ct = String(getContainerType(r) || '').trim().toUpperCase();
    if (ct === 'PALLET') return true;
    const id = String(getOlpnId(r) || '').trim().toUpperCase();
    return id.startsWith('PLT');
  };

  const palletWithBoxesIconHtml = (color) => {
    // Build a "pallet with 2x3 boxes" icon using Font Awesome primitives.
    // (More consistent than relying on a single specialty icon.)
    const box = `<i class="fas fa-box" style="font-size: 0.48rem; line-height: 1; color: ${color};"></i>`;
    return `
      <span style="position: relative; display: inline-block; width: 36px; height: 36px; line-height: 1;">
        <i class="fas fa-pallet" style="position: absolute; left: 50%; top: 60%; transform: translate(-50%, -50%) scale(1.25); color: ${color}; opacity: 0.95;"></i>
        <span style="position: absolute; left: 50%; top: 22%; transform: translateX(-50%); width: 22px; display: flex; flex-direction: column;">
          <span style="display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 1px; justify-items: center; transform: translateY(0.5px);">
            ${box}${box}${box}
          </span>
          <span style="display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 1px; justify-items: center;">
            ${box}${box}${box}
          </span>
        </span>
      </span>
    `;
  };

  const formatIdForCard = (value) => {
    const s = String(value ?? '');
    if (!s) return '';
    // Always preserve rightmost digits on mobile (left-side ellipsis)
    const isMobile = window.innerWidth <= 420;
    const suffixLen = isMobile ? 8 : 12;
    if (s.length <= suffixLen + 3) return s;
    return `...${s.slice(-suffixLen)}`;
  };

  // Group palletized oLPNs by PalletId so we can render them under a pallet card.
  const childrenByPalletId = new Map();
  list.forEach((r) => {
    if (!r || isPalletRecord(r)) return;
    const palletId = String(getPalletId(r) || '').trim();
    if (!palletId) return;
    if (!childrenByPalletId.has(palletId)) childrenByPalletId.set(palletId, []);
    childrenByPalletId.get(palletId).push(r);
  });

  const renderedPalletIds = new Set();

  const renderBoxCard = (record) => {
    const olpnId = String(getOlpnId(record) || '');
    const iconColor = isDelivered(record) ? 'var(--success-color)' : 'var(--danger-color)';

    const card = document.createElement('div');
    card.className = 'olpn-card';
    card.addEventListener('click', () => showOlpnDetail(record));

    const icon = document.createElement('div');
    icon.className = 'olpn-icon';
    icon.innerHTML = `<i class="fas fa-box" style="color: ${iconColor}; font-size: 1.35rem;"></i>`;

    const text = document.createElement('div');
    text.className = 'olpn-text truncate-left';
    text.textContent = formatIdForCard(olpnId) || '(missing OlpnId)';

    card.appendChild(icon);
    card.appendChild(text);
    olpnCards.appendChild(card);
  };

  const renderPalletCard = (palletId, palletRecord, children) => {
    const idText = String(palletId || getOlpnId(palletRecord) || '(missing PalletId)');

    // Prefer pallet record status; otherwise compute from children (all delivered => green).
    const delivered =
      (palletRecord && isDelivered(palletRecord)) ||
      (!palletRecord && Array.isArray(children) && children.length > 0 && children.every((c) => isDelivered(c)));
    const iconColor = delivered ? 'var(--success-color)' : 'var(--danger-color)';

    const card = document.createElement('div');
    card.className = 'olpn-card pallet-card';

    const row = document.createElement('div');
    row.className = 'pallet-row';

    const icon = document.createElement('div');
    icon.className = 'olpn-icon';
    icon.innerHTML = palletWithBoxesIconHtml(iconColor);

    const text = document.createElement('div');
    text.className = 'olpn-text truncate-left';
    text.textContent = formatIdForCard(idText) || idText;

    // Dedicated chevron target for expand/collapse (so the main row remains click-to-details)
    const chevronBtn = document.createElement('button');
    chevronBtn.type = 'button';
    chevronBtn.className = 'olpn-chevron';
    chevronBtn.setAttribute('aria-label', 'Expand pallet');
    chevronBtn.innerHTML = `<i class="fas fa-chevron-down"></i>`;

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'pallet-children';

    const childList = Array.isArray(children) ? children : [];
    childList.forEach((child) => {
      const childId = String(getOlpnId(child) || '');
      const childIconColor = isDelivered(child) ? 'var(--success-color)' : 'var(--danger-color)';

      const childRow = document.createElement('div');
      childRow.className = 'pallet-child';

      const childIcon = document.createElement('div');
      childIcon.className = 'child-icon';
      childIcon.innerHTML = `<i class="fas fa-box" style="color: ${childIconColor}; font-size: 1.1rem;"></i>`;

      const childText = document.createElement('div');
      childText.className = 'child-text truncate-left';
      childText.textContent = formatIdForCard(childId) || '(missing OlpnId)';

      childRow.appendChild(childIcon);
      childRow.appendChild(childText);
      childrenWrap.appendChild(childRow);
    });

    const toggleExpanded = () => {
      const isOpen = childrenWrap.style.display === 'flex';
      if (isOpen) {
        childrenWrap.style.display = 'none';
        chevronBtn.innerHTML = `<i class="fas fa-chevron-down"></i>`;
        chevronBtn.setAttribute('aria-label', 'Expand pallet');
      } else {
        childrenWrap.style.display = 'flex';
        chevronBtn.innerHTML = `<i class="fas fa-chevron-up"></i>`;
        chevronBtn.setAttribute('aria-label', 'Collapse pallet');
      }
    };

    chevronBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExpanded();
    });

    row.addEventListener('click', () => {
      // Clicking the pallet card opens details as normal.
      // If the pallet record isn't present in the response, don't open a child record.
      if (!palletRecord) {
        showStatus('Unable to open pallet details', 'error');
        return;
      }
      showOlpnDetail(palletRecord);
    });

    row.appendChild(icon);
    row.appendChild(text);

    // Only show chevron when there are children to reveal
    if (childList.length > 0) row.appendChild(chevronBtn);

    card.appendChild(row);
    if (childList.length > 0) card.appendChild(childrenWrap);
    olpnCards.appendChild(card);
  };

  // Render top-level list in original order:
  // - Pallet records: render pallet card (with expand)
  // - Palletized oLPNs (PalletId populated): skip as unique cards (they appear under their pallet)
  // - Plain oLPNs: render as normal cards
  list.forEach((record) => {
    if (!record) return;

    if (isPalletRecord(record)) {
      const palletId = String(getOlpnId(record) || '').trim();
      if (!palletId) return;
      if (renderedPalletIds.has(palletId)) return;
      renderedPalletIds.add(palletId);
      renderPalletCard(palletId, record, childrenByPalletId.get(palletId) || []);
      return;
    }

    const palletId = String(getPalletId(record) || '').trim();
    if (palletId) {
      // hide palletized oLPN as a top-level card
      return;
    }

    renderBoxCard(record);
  });

  // If some oLPNs reference a PalletId but the pallet record was not returned,
  // still render a pallet card so users can expand for visibility.
  Array.from(childrenByPalletId.keys())
    .filter((pid) => !renderedPalletIds.has(pid))
    .forEach((pid) => {
      renderPalletCard(pid, null, childrenByPalletId.get(pid) || []);
    });
}

function showOlpnDetail(record) {
  if (deliverySection) deliverySection.style.display = 'none';
  if (olpnDetailSection) olpnDetailSection.style.display = 'block';

  const getField = (obj, keys) => {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return '';
  };

  const olpnId = getField(record, ['OlpnId', 'olpnId', 'OLPNID', 'OLPN_ID']);
  const pk = getField(record, ['Pk', 'PK', 'pk', 'pK']);
  const containerType = getField(record, ['ContainerType', 'ContainerTypeId', 'containerType', 'containerTypeId']);
  const containerSize = getField(record, ['ContainerSize', 'ContainerSizeId', 'containerSize', 'containerSizeId']);
  const podStatus =
    record?.Extended?.PODStatus ??
    record?.extended?.PODStatus ??
    record?.PODStatus ??
    record?.podStatus ??
    record?.PodStatus ??
    '';
  const estVol = getField(record, ['EstimatedVolume', 'estimatedVolume', 'ESTIMATEDVOLUME']);
  const estWgt = getField(record, ['EstimatedWeight', 'estimatedWeight', 'ESTIMATEDWEIGHT']);
  const podCondition =
    record?.Extended?.PODCondition ??
    record?.extended?.PODCondition ??
    record?.PODCondition ??
    record?.podCondition ??
    record?.PodCondition ??
    '';

  selectedOlpnContext = { record, olpnId, pk };

  if (detailOlpnId) detailOlpnId.textContent = String(olpnId || '');
  if (detailStatus) detailStatus.textContent = String(podStatus || '');
  if (detailContainerType) detailContainerType.textContent = String(containerType || '');
  if (detailContainerSize) detailContainerSize.textContent = String(containerSize || '');
  if (detailEstimatedVolume) detailEstimatedVolume.textContent = String(estVol || '');
  if (detailEstimatedWeight) detailEstimatedWeight.textContent = String(estWgt || '');
  renderPodConditionPills(podCondition);
}

async function deliverSelectedOlpn() {
  if (!selectedOlpnContext?.olpnId || !selectedOlpnContext?.pk) {
    showStatus('Missing OlpnId or PK for this OLPN', 'error');
    return;
  }

  const originalText = deliverBtn?.innerHTML;
  if (deliverBtn) {
    deliverBtn.disabled = true;
    deliverBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Delivering...';
  }

  try {
    const podDate = new Date().toISOString(); // proper datetime field
    const targets = getConditionTargets();
    if (targets.length === 0) {
      showStatus('Missing OlpnId or PK for this OLPN', 'error');
      return;
    }

    // Deliver pallet + all child oLPNs (or just the selected oLPN)
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const olpnId = String(t?.olpnId || '').trim();
      const pk = String(t?.pk || '').trim();
      if (!olpnId || !pk) {
        showStatus('Missing OlpnId or PK for this OLPN', 'error');
        return;
      }

      if (deliverBtn && targets.length > 1) {
        deliverBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Delivering ${i + 1}/${targets.length}...`;
      }

      const res = await apiCall('deliver_olpn', {
        org: currentOrg,
        olpnId,
        pk,
        podDate
      });

      if (!res?.success) {
        showStatus(res?.error || `Deliver failed for ${olpnId}`, 'error');
        return;
      }

      // Update in-memory references
      if (selectedOlpnContext?.record && String(selectedOlpnContext.olpnId) === olpnId) {
        setDeliveredOnRecord(selectedOlpnContext.record, podDate);
      }
      updateDeliveryListRecord(olpnId, (rec) => setDeliveredOnRecord(rec, podDate));
      if (t?.record) setDeliveredOnRecord(t.record, podDate);
    }

    // Update UI for the selected record (pallet or oLPN)
    if (detailStatus) detailStatus.textContent = 'DELIVERED';

    showStatus(
      targets.length > 1
        ? `Delivered (${targets.length} records updated)`
        : 'Delivered (Status updated to DELIVERED)',
      'success'
    );
  } catch (e) {
    showStatus(e?.message || 'Deliver failed', 'error');
  } finally {
    if (deliverBtn) {
      deliverBtn.disabled = false;
      if (originalText) deliverBtn.innerHTML = originalText;
    }
  }
}

function stopBarcodeScanner() {
  if (scannerStopPromise) return scannerStopPromise;

  scannerStopPromise = Promise.resolve()
    .then(() => {
      clearScannerFallbackTimer();
      scannerRunning = false;
      zxingDecodeActive = false;
      zxingCallbackSeen = false;
      scannerBackend = null;

      // Stop Quagga if running
      stopQuaggaScanner();
      if (zxingControls && typeof zxingControls.stop === 'function') {
        try {
          zxingControls.stop();
        } catch {
          // ignore
        }
        zxingControls = null;
      }
      if (zxingReader && typeof zxingReader.reset === 'function') {
        try {
          zxingReader.reset();
        } catch {
          // ignore
        }
      }
      if (cameraVideoEl) {
        try {
          cameraVideoEl.pause?.();
        } catch {
          // ignore
        }
        try {
          cameraVideoEl.srcObject = null;
        } catch {
          // ignore
        }
      }
      if (cameraStream) {
        try {
          cameraStream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        cameraStream = null;
      }
      cameraVideoEl = null;
    })
    .finally(() => {
      scannerStopPromise = null;
    });

  return scannerStopPromise;
}

function initBarcodeScanner() {
  if (scannerRunning) return;

  const scannerStatus = document.getElementById('scannerStatus');
  const interactiveElement = document.getElementById('interactive');
  const ZXingBrowser = window.ZXingBrowser;

  if (!interactiveElement) {
    showStatus('Error: Scanner container not found', 'error');
    return;
  }
  if (!ZXingBrowser || !ZXingBrowser.BrowserMultiFormatReader) {
    showStatus('Scanner library not loaded. Please refresh and try again.', 'error');
    if (scannerStatus) scannerStatus.textContent = 'Error: scanner library not loaded';
    return;
  }

  const rect = interactiveElement.getBoundingClientRect?.();
  scannerDebug('initBarcodeScanner()', {
    interactiveRect: rect
      ? { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) }
      : null
  });

  if (scannerStatus) scannerStatus.textContent = 'Initializing camera...';

  interactiveElement.innerHTML = '';
  const video = document.createElement('video');
  video.id = 'zxingVideo';
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.autoplay = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  interactiveElement.appendChild(video);
  cameraVideoEl = video;

  const start = async () => {
    try {
      scannerBackend = 'zxing';
      // Create reader once; reuse between modal opens.
      if (!zxingReader) {
        try {
          const DecodeHintType = ZXingBrowser?.DecodeHintType;
          const BarcodeFormat = ZXingBrowser?.BarcodeFormat;
          const hints =
            DecodeHintType && BarcodeFormat
              ? (() => {
                  const h = new Map();
                  // Prefer accuracy over speed for real-world 1D barcodes.
                  h.set(DecodeHintType.TRY_HARDER, true);
                  // Try inverted too (common with some thermal labels / lighting).
                  if (DecodeHintType.ALSO_INVERTED !== undefined) h.set(DecodeHintType.ALSO_INVERTED, true);

                  // Limit to common formats we expect to see (improves decode success rate).
                  h.set(DecodeHintType.POSSIBLE_FORMATS, [
                    BarcodeFormat.CODE_128,
                    BarcodeFormat.CODE_39,
                    BarcodeFormat.EAN_13,
                    BarcodeFormat.EAN_8,
                    BarcodeFormat.UPC_A,
                    BarcodeFormat.UPC_E,
                    BarcodeFormat.ITF,
                    BarcodeFormat.QR_CODE,
                    BarcodeFormat.DATA_MATRIX,
                    BarcodeFormat.PDF_417
                  ]);
                  return h;
                })()
              : null;

          // Second constructor arg is timeBetweenScansMillis (keeps CPU reasonable on mobile).
          zxingReader = hints
            ? new ZXingBrowser.BrowserMultiFormatReader(hints, 200)
            : new ZXingBrowser.BrowserMultiFormatReader(undefined, 200);
        } catch (e) {
          throw new Error(`Failed to initialize scanner: ${e?.message || e}`);
        }
      }

      // Prefer explicit device selection (more reliable than facingMode on some phones/browsers).
      let selectedDeviceId = null;
      try {
        const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
        if (SCANNER_DEBUG_ENABLED) {
          scannerDebug(
            'video devices',
            (devices || []).map((d) => ({ deviceId: d.deviceId, label: d.label }))
          );
        }
        if (devices && devices.length > 0) {
          const byLabel = devices.find((d) => /back|rear|environment/i.test(String(d.label || '')));
          selectedDeviceId = (byLabel || devices[devices.length - 1]).deviceId;
        }
      } catch (e) {
        // Ignore; we'll fall back to constraints selection.
        if (SCANNER_DEBUG_ENABLED) scannerDebug('listVideoInputDevices failed', e?.message || String(e));
      }

      scannerRunning = true;
      zxingDecodeActive = true;
      zxingCallbackSeen = false;
      if (SCANNER_DEBUG_ENABLED) {
        window.__scannerDecodeCount = 0;
        window.__scannerNotFoundCount = 0;
      }

      const onDecode = (result, err, controls) => {
        if (!scannerRunning || !zxingDecodeActive) return;
        if (!zxingControls && controls) zxingControls = controls;

        if (!zxingCallbackSeen) {
          zxingCallbackSeen = true;
          scannerDebug('zxing decode callback active');
        }

        // Ignore frequent "not found" errors (normal while scanning)
        if (!result) {
          if (SCANNER_DEBUG_ENABLED) {
            window.__scannerNotFoundCount = (window.__scannerNotFoundCount || 0) + 1;
          }
          const errName = String(err?.name || '');
          const errMsg = String(err?.message || '');
          const isNotFoundLike =
            errName === 'NotFoundException' ||
            /no\s+multiformat\s+readers\s+were\s+able\s+to\s+detect/i.test(errMsg);
          if (err && errName && !isNotFoundLike) {
            scannerDebug('zxing decode error', { name: errName, message: errMsg || String(err) });
          }
          return;
        }

        const rawText = typeof result.getText === 'function' ? result.getText() : String(result?.text || '');
        const { parsed, code } = normalizeCandidateCode(rawText);

        if (SCANNER_DEBUG_ENABLED) window.__scannerDecodeCount = (window.__scannerDecodeCount || 0) + 1;
        scannerDebug('decoded', {
          backend: 'zxing',
          raw: String(parsed.raw || '').slice(0, 200),
          shipmentId: code,
          inferredSource: parsed.inferredSource,
          format: result?.getBarcodeFormat?.()
        });

        // If we decoded something, but it isn't a usable shipment id, keep scanning.
        // (Most commonly: QR codes with URL/query-string payloads; we extract Shipment/ShipmentId above.)
        if (!code) return;
        clearScannerFallbackTimer();
        applyStableScanAndMaybeAccept(code, parsed.inferredSource);
      };

      if (scannerStatus) scannerStatus.textContent = 'Starting camera...';

      // Let ZXingBrowser own camera lifecycle.
      // Prefer decodeFromVideoDevice when possible, else fall back to decodeFromConstraints.
      if (selectedDeviceId) {
        zxingControls = await zxingReader.decodeFromVideoDevice(selectedDeviceId, video, onDecode);
      } else {
        const constraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        };
        zxingControls = await zxingReader.decodeFromConstraints(constraints, video, onDecode);
      }
      cameraStream = video.srcObject || null;

      if (scannerStatus) scannerStatus.textContent = 'Camera ready. Point at barcode or QR code to scan...';
      showStatus('Camera ready. Point at barcode or QR code to scan.', 'info');
      scannerDebug('zxing ready', { vw: video.videoWidth, vh: video.videoHeight });

      // If ZXing doesn't produce a usable decode quickly, switch to Quagga2 for 1D barcodes.
      scheduleScannerFallbackToQuagga();
    } catch (err) {
      console.error('Scanner init failed:', err);
      scannerRunning = false;
      zxingDecodeActive = false;
      zxingCallbackSeen = false;
      scannerBackend = null;
      if (scannerStatus) scannerStatus.textContent = `Error: ${err?.message || 'Scanner init failed'}`;
      showStatus(`Error: ${err?.message || 'Scanner init failed'}`, 'error');
      stopBarcodeScanner();
    }
  };

  start();
}

// Process scanned code (from either 1D barcode or QR code)
function processScannedCode(code, source) {
  // Store scan source for validation tracking
  window._lastScanSource = source === 'QR Code' ? 'qr_code' : 'camera';
  
  // Track barcode scan with proof of delivery specific metadata
  trackEvent('barcode_scanned', {
    org: currentOrg || 'unknown',
    scan_source: source === 'QR Code' ? 'qr_code' : 'camera',
    barcode: code.substring(0, 100), // Limit length for metadata
    code_length: String(code.length),
    camera_used: true
  });
  
  const parsed = extractShipmentIdFromScannedText(code);
  const shipmentId = parsed.shipmentId || String(code || '').trim();

  // Validate format - shipment id should be url-safe alphanum with a few separators
  if (shipmentId.length > 0 && /^[A-Za-z0-9][A-Za-z0-9\-_:]{2,}$/.test(shipmentId)) {
    console.log(`Processing scanned code from ${source}:`, shipmentId);
    barcodeInput.value = shipmentId;
    closeCamera();
    validateBarcode(shipmentId);
  } else {
    console.warn(`Invalid code format detected from ${source}:`, code);
    showStatus(`Scanned: "${String(code || '').trim()}" - Does not look like a valid shipment ID. Please try again.`, 'error');
    
    // Track invalid scan with proof of delivery specific metadata
    trackEvent('barcode_scan_invalid', {
      org: currentOrg || 'unknown',
      scan_source: source === 'QR Code' ? 'qr_code' : 'camera',
      barcode: code.substring(0, 50), // Limit length
      code_length: String(code.length),
      camera_used: true
    });
  }
}

// Open camera modal
function openCamera() {
  cameraModal.classList.add('active');
  
  // Push a history state to intercept back button
  // This prevents users from accidentally navigating away
  if (history.pushState) {
    cameraModalHistoryState = { modal: 'camera', timestamp: Date.now() };
    history.pushState(cameraModalHistoryState, '', window.location.href);
  }
  
  // Reset scan stability counters each time we open
  lastScanTime = 0;
  lastScannedCode = '';
  scanCount = 0;
  if (SCANNER_DEBUG_ENABLED) window.__scannerDecodeCount = 0;

  // Start immediately from click handler (helps on mobile Safari gesture requirements)
  initBarcodeScanner();
}

// Close camera modal
function closeCamera() {
  const interactiveElement = document.getElementById('interactive');
  stopBarcodeScanner().finally(() => {
    if (interactiveElement) interactiveElement.innerHTML = '';
  });
  
  cameraModal.classList.remove('active');
  // Keep overlay markup (scanning frame); only clear scanner container
  
  // Remove the history state we added when opening the modal
  // If user clicked Close button (not back button), we need to clean up the history state
  if (cameraModalHistoryState && history.state && history.state.modal === 'camera') {
    // Replace the state with current state to remove our modal state from history
    history.replaceState(null, '', window.location.href);
    cameraModalHistoryState = null;
  }
}

// Enhance signature image with logo and metadata above the signature
async function enhanceSignatureImage() {
  return new Promise((resolve, reject) => {
    const canvas = signaturePad.canvas;
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    
    // Load and draw the Manhattan logo
    const logo = new Image();
    logo.onload = () => {
      // Logo dimensions - scale to fit nicely in upper left
      const logoWidth = 120;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      const padding = 10;
      
      // Prepare text data
      const shipmentId = currentShipmentId || 'N/A';
      const billOfLading = billOfLadingField.value || 'N/A';
      const driver = driverField.value || 'N/A';
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      // Calculate header height needed for logo + text
      const lineHeight = 18;
      const textLines = 4; // Shipment, BOL, Signed by, Timestamp
      const textSpacing = 15; // Space between logo and first text line
      const headerHeight = padding + logoHeight + textSpacing + (textLines * lineHeight) + padding;
      
      // Create a new canvas that's taller (original height + header height)
      const enhancedCanvas = document.createElement('canvas');
      enhancedCanvas.width = originalWidth;
      enhancedCanvas.height = originalHeight + headerHeight;
      const ctx = enhancedCanvas.getContext('2d');
      
      // Fill entire canvas with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, enhancedCanvas.width, enhancedCanvas.height);
      
      // Draw logo in upper left corner of header area
      ctx.drawImage(logo, padding, padding, logoWidth, logoHeight);
      
      // Text settings
      ctx.font = '12px Arial, sans-serif';
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      // Starting position below logo in header area
      let textY = padding + logoHeight + textSpacing;
      const textX = padding;
      
      // Draw text lines in header area
      ctx.fillText(`Shipment ${shipmentId}`, textX, textY);
      textY += lineHeight;
      
      ctx.fillText(`BOL: ${billOfLading}`, textX, textY);
      textY += lineHeight;
      
      ctx.fillText(`Signed by: ${driver}`, textX, textY);
      textY += lineHeight;
      
      ctx.fillText(timestamp, textX, textY);
      
      // Draw the original signature below the header area
      ctx.drawImage(canvas, 0, headerHeight);
      
      // Convert to base64
      const enhancedDataURL = enhancedCanvas.toDataURL('image/png');
      const base64Data = enhancedDataURL.replace(/^data:image\/png;base64,/, '');
      resolve({ dataURL: enhancedDataURL, base64Data: base64Data });
    };
    
    logo.onerror = () => {
      console.warn('Logo failed to load, using signature without logo');
      // If logo fails, just use the original signature
      const dataURL = signaturePad.toDataURL('image/png');
      const base64Data = dataURL.replace(/^data:image\/png;base64,/, '');
      resolve({ dataURL: dataURL, base64Data: base64Data });
    };
    
    // Load logo from the same directory
    logo.src = '/manhattan-logo.png';
  });
}

// Confirm pickup (upload signature to Manhattan WMS)
async function confirmPickup() {
  // Validate signature is not empty
  if (signaturePad.isEmpty()) {
    showErrorModal('Please sign before confirming pickup');
    return;
  }
  
  // Validate driver name is provided
  const driverName = driverField.value.trim();
  if (!driverName) {
    showErrorModal('Driver name is required. Please enter the driver name before confirming pickup.');
    driverField.focus();
    return;
  }
  
  // Validate token exists
  if (!token) {
    showStatus('Authentication required. Please authenticate first.', 'error');
    return;
  }
  
  // Validate shipment ID exists
  if (!currentShipmentId) {
    showStatus('Shipment ID required. Please validate a barcode first.', 'error');
    return;
  }
  
  // Track pickup confirmation attempt
  await trackEvent('pickup_confirmation_attempt', {
    org: currentOrg || 'unknown',
    shipment_id: currentShipmentId,
    driver: driverField.value || '',
    timestamp: new Date().toISOString()
  });
  
  // Disable button and show loading state
  confirmPickupBtn.disabled = true;
  const originalText = confirmPickupBtn.innerHTML;
  confirmPickupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
  showStatus('Uploading signature...', 'info');
  
  try {
    // Get enhanced signature with logo and metadata
    const { dataURL, base64Data } = await enhanceSignatureImage();
    
    // Generate filename: Signature_{ShipmentId}.png
    const filename = `Signature_${currentShipmentId}.png`;
    
    // Driver name already validated above, use it for Notes field
    
    // Format timestamp to match signature image format (same timezone)
    const timestamp = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // Upload to Manhattan WMS
    const res = await apiCall('upload_signature', {
      org: currentOrg,
      shipmentId: currentShipmentId,
      filename: filename,
      fileData: base64Data,
      driver: driverName,
      timestamp: timestamp
    });
    
    if (!res.success) {
      // Show error with actual server response for troubleshooting
      const errorMsg = res.error || 'Signature upload failed';
      showStatus(`Upload failed: ${errorMsg}`, 'error');
      
      // Track upload failure
      await trackEvent('pickup_confirmation_failed', {
        org: currentOrg || 'unknown',
        shipment_id: currentShipmentId,
        error: errorMsg,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // Success - show success message
    showStatus('Pickup confirmed successfully!', 'success');
    
    // Track successful pickup confirmation
    await trackEvent('pickup_confirmed', {
      org: currentOrg || 'unknown',
      shipment_id: currentShipmentId,
      driver: driverField.value || '',
      carrier: carrierField.value || '',
      trailer: trailerField.value || '',
      timestamp: new Date().toISOString()
    });
    
    // Store in localStorage as backup (using enhanced image)
    localStorage.setItem(`signature_${currentShipmentId}`, dataURL);
    
    // Return to cards screen after 1.5s (keep barcode + shipment; hide pickup UI, clear signature)
    setTimeout(() => {
      hideStatus();
      shipmentInfo.style.display = 'none';
      const signatureSection = document.querySelector('.signature-section');
      if (signatureSection) signatureSection.style.display = 'none';
      if (signaturePad) signaturePad.clear();
      if (cardsSection) cardsSection.style.display = 'block';
    }, 1500); // Wait 1.5 seconds to show success message
    
  } catch (error) {
    console.error('Signature upload error:', error);
    showStatus(`Upload error: ${error.message || 'Unknown error'}`, 'error');
    
    // Track upload error with proof of delivery specific metadata
    trackEvent('pickup_confirmation_failed', {
      org: currentOrg || 'unknown',
      shipment_id: currentShipmentId || '',
      driver_name: driverName || '',
      error: error.message || 'Unknown error',
      error_message: error.message || 'Unknown error',
      upload_duration_ms: Date.now() - pickupStartTime,
      upload_success: false
    });
  } finally {
    // Re-enable button
    confirmPickupBtn.disabled = false;
    confirmPickupBtn.innerHTML = originalText;
  }
}

// Clear signature
function clearSignature() {
  if (signaturePad) {
    signaturePad.clear();
    signatureClearCount++;
    showStatus('Signature cleared', 'info');
  }
}

// Download signature

// Theme Management
const DEFAULT_THEME_KEY = 'manhattan';

const THEMES = {
  default: {
    name: 'Default (Dark)',
    colors: {
      '--bg-color': '#121212',
      '--text-color': '#e0e0e0',
      '--text-muted': '#bbbbbb',
      '--card-bg': '#1e1e1e',
      '--border-color': '#333',
      '--input-bg': '#2d2d2d',
      '--input-border': '#444',
      '--input-focus-bg': '#333',
      '--input-focus-border': '#0d6efd',
      '--input-focus-shadow': 'rgba(13, 110, 253, 0.25)',
      '--primary-color': '#0d6efd',
      '--primary-hover': '#0b5ed7',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#111827',
      '--header-text': '#e5e7eb'
    }
  },
  loves: {
    name: "Love's Travel Stops",
    colors: {
      '--bg-color': '#f8f9fa',
      '--text-color': '#212529',
      '--text-muted': '#6c757d',
      '--card-bg': '#ffffff',
      '--border-color': '#dee2e6',
      '--input-bg': '#f5f5f5',
      '--input-border': '#ced4da',
      '--input-focus-bg': '#ffffff',
      '--input-focus-border': '#E31837',
      '--input-focus-shadow': 'rgba(227, 24, 55, 0.25)',
      '--primary-color': '#E31837',
      '--primary-hover': '#C0142D',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#f1f5f9',
      '--header-text': '#1f2933'
    }
  },
  manhattan: {
    name: 'Manhattan',
    colors: {
      '--bg-color': '#f5f7fa',
      '--text-color': '#1a1a1a',
      '--text-muted': '#4a5568',
      '--card-bg': '#ffffff',
      '--border-color': '#e1e8ed',
      '--input-bg': '#f0f2f5',
      '--input-border': '#cbd5e0',
      '--input-focus-bg': '#ffffff',
      '--input-focus-border': '#0066cc',
      '--input-focus-shadow': 'rgba(0, 102, 204, 0.25)',
      '--primary-color': '#0066cc',
      '--primary-hover': '#0052a3',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#dce7f5',
      '--header-text': '#0f172a'
    }
  },
  msc: {
    name: 'MSC Industrial',
    colors: {
      '--bg-color': '#fafafa',
      '--text-color': '#1a1a1a',
      '--text-muted': '#757575',
      '--card-bg': '#ffffff',
      '--border-color': '#e0e0e0',
      '--input-bg': '#f0f0f0',
      '--input-border': '#bdbdbd',
      '--input-focus-bg': '#ffffff',
      '--input-focus-border': '#003d82',
      '--input-focus-shadow': 'rgba(0,61,130,0.25)',
      '--primary-color': '#003d82',
      '--primary-hover': '#002d5f',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#e5e7eb',
      '--header-text': '#1f1f1f'
    }
  },
  'corporate-blue': {
    name: 'Corporate Blue',
    colors: {
      '--bg-color': '#e3f2fd',
      '--text-color': '#0d47a1',
      '--text-muted': '#1976d2',
      '--card-bg': '#ffffff',
      '--border-color': '#90caf9',
      '--input-bg': '#f5f5f5',
      '--input-border': '#90caf9',
      '--input-focus-bg': '#ffffff',
      '--input-focus-border': '#1565c0',
      '--input-focus-shadow': 'rgba(21,101,192,0.25)',
      '--primary-color': '#1565c0',
      '--primary-hover': '#0d47a1',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#bbdefb',
      '--header-text': '#0d47a1'
    }
  },
  'minimal-light': {
    name: 'Minimal Light',
    colors: {
      '--bg-color': '#ffffff',
      '--text-color': '#1f2933',
      '--text-muted': '#616e7c',
      '--card-bg': '#f8fafc',
      '--border-color': '#d9e2ec',
      '--input-bg': '#ffffff',
      '--input-border': '#cbd5e0',
      '--input-focus-bg': '#ffffff',
      '--input-focus-border': '#5a67d8',
      '--input-focus-shadow': 'rgba(90,103,216,0.25)',
      '--primary-color': '#5a67d8',
      '--primary-hover': '#4c51bf',
      '--success-color': '#28a745',
      '--danger-color': '#dc3545',
      '--header-bg': '#d9e2ec',
      '--header-text': '#1f2933'
    }
  }
};

function applyTheme(themeKey) {
  const theme = THEMES[themeKey];
  if (!theme) return;
  
  Object.entries(theme.colors).forEach(([prop, value]) => {
    document.documentElement.style.setProperty(prop, value);
  });
  
  localStorage.setItem('proofOfDeliveryTheme', themeKey);
}

function loadTheme() {
  const saved = localStorage.getItem('proofOfDeliveryTheme') || DEFAULT_THEME_KEY;
  applyTheme(saved);
}

function renderThemeList() {
  if (!themeList) {
    console.error('themeList element not found');
    return;
  }
  const current = localStorage.getItem('proofOfDeliveryTheme') || DEFAULT_THEME_KEY;
  themeList.innerHTML = '';
  Object.entries(THEMES).forEach(([key, theme]) => {
    const btn = document.createElement('button');
    btn.textContent = theme.name;
    btn.className = key === current ? 'active' : '';
    btn.onclick = () => {
      applyTheme(key);
      closeThemeModal();
    };
    themeList.appendChild(btn);
  });
  console.log('Theme list rendered', themeList.children.length, 'themes');
  console.log('Theme modal element:', themeModal);
  console.log('Theme modal hidden attribute:', themeModal?.getAttribute('hidden'));
  console.log('Theme modal computed display:', window.getComputedStyle(themeModal).display);
}

function isModalVisible(el) {
  return el && !el.hidden;
}

function showBackdrop() {
  if (modalBackdrop) modalBackdrop.hidden = false;
}

function hideBackdropIfNone() {
  if (modalBackdrop && !isModalVisible(themeModal) && !isModalVisible(conditionModal)) {
    modalBackdrop.hidden = true;
  }
}

function openThemeModal() {
  if (!themeModal) return;
  renderThemeList();
  themeModal.removeAttribute('hidden');
  themeModal.style.display = 'flex'; // Explicitly set display
  themeModal.style.visibility = 'visible';
  themeModal.style.opacity = '1';
  themeModal.style.zIndex = '1001';
  showBackdrop();
  console.log('Theme modal opened', themeModal);
  console.log('Theme modal computed display after open:', window.getComputedStyle(themeModal).display);
  console.log('Theme modal computed visibility:', window.getComputedStyle(themeModal).visibility);
  console.log('Theme modal computed opacity:', window.getComputedStyle(themeModal).opacity);
  console.log('Theme modal computed z-index:', window.getComputedStyle(themeModal).zIndex);
  console.log('Theme modal parent:', themeModal.parentElement);
}

function closeThemeModal() {
  if (!themeModal) return;
  themeModal.setAttribute('hidden', '');
  themeModal.style.display = 'none'; // Explicitly set display
  hideBackdropIfNone();
  console.log('Theme modal closed');
}

async function openPhotoModal() {
  if (!photoModal || !photoVideo) return;
  photoModal.classList.add('active');

  // Reset UI
  if (photoPreview) photoPreview.style.display = 'none';
  if (photoVideo) photoVideo.style.display = 'block';
  if (retakePhotoBtn) retakePhotoBtn.style.display = 'none';
  if (uploadPhotoBtn) uploadPhotoBtn.style.display = 'none';
  if (capturePhotoBtn) capturePhotoBtn.style.display = 'inline-flex';
  capturedPhotoDataUrl = null;

  try {
    photoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
    photoVideo.srcObject = photoStream;
    await photoVideo.play();
  } catch (e) {
    console.error('Photo camera error:', e);
    showStatus('Unable to access camera for photo capture', 'error');
    closePhotoModal();
  }
}

function closePhotoModal() {
  if (!photoModal) return;
  photoModal.classList.remove('active');

  if (photoVideo) {
    photoVideo.pause?.();
    photoVideo.srcObject = null;
  }
  if (photoStream) {
    photoStream.getTracks().forEach((t) => t.stop());
    photoStream = null;
  }

  if (photoPreview) {
    photoPreview.src = '';
    photoPreview.style.display = 'none';
  }
  if (retakePhotoBtn) retakePhotoBtn.style.display = 'none';
  if (uploadPhotoBtn) uploadPhotoBtn.style.display = 'none';
  if (capturePhotoBtn) capturePhotoBtn.style.display = 'inline-flex';
  capturedPhotoDataUrl = null;
}

function capturePhoto() {
  if (!photoVideo || !photoCanvas || !photoPreview) return;
  const w = photoVideo.videoWidth;
  const h = photoVideo.videoHeight;
  if (!w || !h) return;

  photoCanvas.width = w;
  photoCanvas.height = h;
  const ctx = photoCanvas.getContext('2d');
  ctx.drawImage(photoVideo, 0, 0, w, h);

  const dataUrl = photoCanvas.toDataURL('image/jpeg', 0.9);
  capturedPhotoDataUrl = dataUrl;
  photoPreview.src = dataUrl;
  photoPreview.style.display = 'block';
  photoVideo.style.display = 'none';
  if (retakePhotoBtn) retakePhotoBtn.style.display = 'inline-flex';
  if (uploadPhotoBtn) uploadPhotoBtn.style.display = 'inline-flex';
  if (capturePhotoBtn) capturePhotoBtn.style.display = 'none';

  // For now we just keep the preview; later this can be uploaded/saved.
}

function retakePhoto() {
  if (!photoVideo || !photoPreview) return;
  photoPreview.style.display = 'none';
  photoVideo.style.display = 'block';
  if (retakePhotoBtn) retakePhotoBtn.style.display = 'none';
  if (uploadPhotoBtn) uploadPhotoBtn.style.display = 'none';
  if (capturePhotoBtn) capturePhotoBtn.style.display = 'inline-flex';
  capturedPhotoDataUrl = null;
}

async function uploadCapturedPhoto() {
  if (!capturedPhotoDataUrl) {
    showStatus('Capture a photo first', 'error');
    return;
  }
  if (!token || !currentOrg) {
    showStatus('Authentication required', 'error');
    return;
  }
  if (!currentShipmentId) {
    showStatus('Shipment is required (validate a shipment first)', 'error');
    return;
  }
  if (!selectedOlpnContext?.olpnId) {
    showStatus('OLPN is required (open an OLPN first)', 'error');
    return;
  }

  // data:image/jpeg;base64,....
  const base64Data = String(capturedPhotoDataUrl).split(',')[1] || '';
  if (!base64Data) {
    showStatus('Invalid photo data', 'error');
    return;
  }

  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const filename = `PODPhoto_${String(selectedOlpnContext.olpnId)}.jpg`;

  const originalText = uploadPhotoBtn?.innerHTML;
  if (uploadPhotoBtn) {
    uploadPhotoBtn.disabled = true;
    uploadPhotoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
  }

  try {
    const res = await apiCall('upload_pod_photo', {
      org: currentOrg,
      shipmentId: currentShipmentId,
      olpnId: String(selectedOlpnContext.olpnId),
      filename,
      fileData: base64Data,
      timestamp
    });

    if (!res?.success) {
      showStatus(res?.error || 'Photo upload failed', 'error');
      return;
    }

    showStatus('Photo uploaded', 'success');
    closePhotoModal();
  } catch (e) {
    showStatus(e?.message || 'Photo upload failed', 'error');
  } finally {
    if (uploadPhotoBtn) {
      uploadPhotoBtn.disabled = false;
      if (originalText) uploadPhotoBtn.innerHTML = originalText;
    }
  }
}

async function openConditionModal() {
  if (!conditionModal) return;

  // Reset selection
  selectedConditionCode = null;
  if (conditionApplyBtn) conditionApplyBtn.disabled = true;
  if (conditionList) conditionList.innerHTML = '';

  conditionModal.removeAttribute('hidden');
  conditionModal.style.display = 'flex';
  conditionModal.style.visibility = 'visible';
  conditionModal.style.opacity = '1';
  conditionModal.style.zIndex = '1001';
  showBackdrop();

  if (conditionLoading) conditionLoading.style.display = 'block';

  try {
    if (!conditionCodesCache) {
      const res = await apiCall('get_olpn_condition_codes', { org: currentOrg });
      if (!res?.success) throw new Error(res?.error || 'Failed to load condition codes');
      conditionCodesCache = Array.isArray(res.data) ? res.data : [];
    }

    renderConditionCodes(conditionCodesCache);
  } catch (e) {
    showStatus(e?.message || 'Failed to load condition codes', 'error');
    renderConditionCodes([]);
  } finally {
    if (conditionLoading) conditionLoading.style.display = 'none';
  }
}

function closeConditionModal() {
  if (!conditionModal) return;
  conditionModal.setAttribute('hidden', '');
  conditionModal.style.display = 'none';
  hideBackdropIfNone();
}

function getConditionCodeId(rec) {
  return (
    rec?.ConditionCodeId ??
    rec?.conditionCodeId ??
    rec?.CONDITIONCODEID ??
    ''
  );
}

function normalizeConditionList(list) {
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function parseCommaList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}

function joinCommaList(items) {
  return (Array.isArray(items) ? items : [])
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0)
    .join(',');
}

function renderPodConditionPills(podConditionValue) {
  if (!detailConditionCodes) return;
  const codes = parseCommaList(podConditionValue);
  detailConditionCodes.innerHTML = '';

  codes.forEach((code) => {
    const pill = document.createElement('span');
    pill.className = 'condition-pill';

    const text = document.createElement('span');
    text.className = 'code-text';
    text.textContent = code;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'condition-remove-btn';
    removeBtn.setAttribute('aria-label', `Remove ${code}`);
    removeBtn.innerHTML = '<i class="fas fa-xmark"></i>';
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removePodConditionCode(code);
    });

    pill.appendChild(text);
    pill.appendChild(removeBtn);
    detailConditionCodes.appendChild(pill);
  });
}

function getRecordOlpnId(record) {
  return (
    record?.OlpnId ??
    record?.olpnId ??
    record?.OLPNID ??
    record?.OLPN_ID ??
    ''
  );
}

function getRecordPk(record) {
  return record?.Pk ?? record?.PK ?? record?.pk ?? record?.pK ?? '';
}

function getRecordPalletId(record) {
  return record?.PalletId ?? record?.palletId ?? record?.PALLETID ?? record?.PALLET_ID ?? '';
}

function getRecordLpnType(record) {
  return record?.LpnType ?? record?.lpnType ?? record?.LPNTYPE ?? '';
}

function isPalletRecordForActions(record) {
  const t = String(getRecordLpnType(record) || '').trim().toUpperCase();
  if (t === 'PALLET') return true;
  const id = String(getRecordOlpnId(record) || '').trim().toUpperCase();
  return id.startsWith('PLT');
}

function getPodConditionFromRecord(record) {
  return (
    record?.Extended?.PODCondition ??
    record?.extended?.PODCondition ??
    record?.PODCondition ??
    record?.podCondition ??
    record?.PodCondition ??
    ''
  );
}

function setPodConditionOnRecord(record, nextPodCondition) {
  if (!record) return;
  record.PODCondition = nextPodCondition;
  record.PodCondition = nextPodCondition;
  record.podCondition = nextPodCondition;
  if (record.Extended && typeof record.Extended === 'object') {
    record.Extended.PODCondition = nextPodCondition;
  } else {
    record.Extended = { PODCondition: nextPodCondition };
  }
}

function setDeliveredOnRecord(record, podDate) {
  if (!record) return;
  if (record.Extended && typeof record.Extended === 'object') {
    record.Extended.PODStatus = 'DELIVERED';
    record.Extended.PODDate = podDate;
  } else {
    record.Extended = { PODStatus: 'DELIVERED', PODDate: podDate };
  }
}

function getConditionTargets() {
  const base = selectedOlpnContext?.record;
  const baseOlpnId = String(selectedOlpnContext?.olpnId || '').trim();
  const basePk = String(selectedOlpnContext?.pk || '').trim();
  if (!base || !baseOlpnId || !basePk) return [];

  // Non-pallet behavior stays the same
  if (!isPalletRecordForActions(base)) {
    return [{ record: base, olpnId: baseOlpnId, pk: basePk }];
  }

  // Pallet: apply to pallet record + all child oLPNs where PalletId == pallet OlpnId
  const palletKey = String(baseOlpnId || '').trim().toUpperCase();
  const targets = [{ record: base, olpnId: baseOlpnId, pk: basePk }];

  const list = Array.isArray(window._deliveryOlpns) ? window._deliveryOlpns : [];
  list.forEach((r) => {
    if (!r) return;
    // Only exclude true pallet records (don't use id-prefix heuristics here)
    const rType = String(getRecordLpnType(r) || '').trim().toUpperCase();
    if (rType === 'PALLET') return;

    const pid = String(getRecordPalletId(r) || '').trim();
    const pidKey = String(pid || '').trim().toUpperCase();
    if (!pidKey || pidKey !== palletKey) return;
    const rid = String(getRecordOlpnId(r) || '').trim();
    const rpk = String(getRecordPk(r) || '').trim();
    if (!rid || !rpk) return;
    targets.push({ record: r, olpnId: rid, pk: rpk });
  });

  // De-dupe by olpnId
  const uniq = new Map();
  targets.forEach((t) => {
    if (!t?.olpnId) return;
    if (!uniq.has(t.olpnId)) uniq.set(t.olpnId, t);
  });
  return Array.from(uniq.values());
}

function updateDeliveryListRecord(olpnId, updater) {
  if (!Array.isArray(window._deliveryOlpns)) return;
  const idx = window._deliveryOlpns.findIndex((r) => String(getRecordOlpnId(r) || '') === String(olpnId || ''));
  if (idx < 0) return;
  updater(window._deliveryOlpns[idx]);
}

async function savePodConditionUpdates(updates, successMessage) {
  const list = Array.isArray(updates) ? updates : [];
  if (list.length === 0) {
    showStatus('Missing OlpnId or PK for this OLPN', 'error');
    return false;
  }

  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    const olpnId = String(u?.olpnId || '').trim();
    const pk = String(u?.pk || '').trim();
    const podCondition = u?.podCondition ?? '';
    if (!olpnId || !pk) {
      showStatus('Missing OlpnId or PK for this OLPN', 'error');
      return false;
    }

    const res = await apiCall('apply_pod_condition', {
      org: currentOrg,
      olpnId,
      pk,
      podCondition
    });

    if (!res?.success) {
      showStatus(res?.error || `Save failed for ${olpnId}`, 'error');
      return false;
    }

    // Update in-memory references
    if (selectedOlpnContext?.record && String(selectedOlpnContext.olpnId) === olpnId) {
      setPodConditionOnRecord(selectedOlpnContext.record, podCondition);
    }
    updateDeliveryListRecord(olpnId, (rec) => setPodConditionOnRecord(rec, podCondition));
    if (u?.record) setPodConditionOnRecord(u.record, podCondition);
  }

  // Refresh pills based on the currently selected record (pallet or oLPN)
  const currentValue = getPodConditionFromRecord(selectedOlpnContext?.record || {});
  renderPodConditionPills(currentValue);

  if (successMessage) showStatus(successMessage, 'success');
  return true;
}

async function removePodConditionCode(codeToRemove) {
  const targets = getConditionTargets();
  if (targets.length === 0) {
    showStatus('Missing OlpnId or PK for this OLPN', 'error');
    return;
  }

  const updates = targets.map((t) => {
    const existing = getPodConditionFromRecord(t.record || {});
    const parts = parseCommaList(existing);
    const nextParts = parts.filter((x) => x.toUpperCase() !== String(codeToRemove).toUpperCase());
    return { ...t, podCondition: joinCommaList(nextParts) };
  });

  try {
    await savePodConditionUpdates(updates, 'Condition removed');
  } catch {
    // savePodConditionUpdates shows errors
  }
}

async function applySelectedCondition() {
  const conditionCodeId = getConditionCodeId(selectedConditionCode);
  if (!conditionCodeId) {
    showStatus('Select a condition code first', 'error');
    return;
  }
  const targets = getConditionTargets();
  if (targets.length === 0) {
    showStatus('Missing OlpnId or PK for this OLPN', 'error');
    return;
  }

  const updates = targets.map((t) => {
    const existing = getPodConditionFromRecord(t.record || {});
    const parts = parseCommaList(existing);
    const alreadyExists = parts.some((x) => x.toUpperCase() === String(conditionCodeId).toUpperCase());
    const nextParts = alreadyExists ? [...parts] : [...parts, String(conditionCodeId).trim()];
    return { ...t, podCondition: joinCommaList(nextParts) };
  });

  const originalText = conditionApplyBtn?.innerHTML;
  if (conditionApplyBtn) {
    conditionApplyBtn.disabled = true;
    conditionApplyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Applying...';
  }

  try {
    const ok = await savePodConditionUpdates(updates, 'Condition saved');
    if (!ok) return;
    closeConditionModal();
  } catch (e) {
    showStatus(e?.message || 'Apply condition failed', 'error');
  } finally {
    if (conditionApplyBtn) {
      conditionApplyBtn.disabled = !selectedConditionCode;
      if (originalText) conditionApplyBtn.innerHTML = originalText;
    }
  }
}

function renderConditionCodes(records) {
  if (!conditionList) return;
  conditionList.innerHTML = '';

  const sorted = [...records].sort((a, b) => {
    const ad = String(a?.Description ?? '').toLowerCase();
    const bd = String(b?.Description ?? '').toLowerCase();
    return ad.localeCompare(bd);
  });

  sorted.forEach((rec) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = String(rec?.Description ?? '(no description)');
    btn.className = '';
    btn.onclick = () => {
      selectedConditionCode = rec;
      if (conditionApplyBtn) conditionApplyBtn.disabled = false;
      // mark active selection
      Array.from(conditionList.children).forEach((child) => child.classList.remove('active'));
      btn.classList.add('active');
    };
    conditionList.appendChild(btn);
  });
}

// Event Listeners
orgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    authenticate();
  }
});

barcodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    validateBarcode(barcodeInput.value);
  }
});

cameraBtn.addEventListener('click', openCamera);
closeCameraBtn.addEventListener('click', closeCamera);

confirmPickupBtn.addEventListener('click', confirmPickup);
clearSignatureBtn.addEventListener('click', clearSignature);

pickupCard?.addEventListener('click', () => showPickupScreen());
deliveryCard?.addEventListener('click', showStopsScreen);
backToCardsBtn?.addEventListener('click', showCardsScreen);
backFromStopsBtn?.addEventListener('click', showCardsScreen);
backFromDeliveryBtn?.addEventListener('click', () => {
  // If Delivery was reached via Stops (even if there is only one DL stop during testing),
  // go back to Stops. Otherwise, return to the main cards screen.
  if (deliveryReachedViaStops) {
    showStopsScreen();
    return;
  }
  showCardsScreen();
});
backFromOlpnDetailBtn?.addEventListener('click', () => {
  if (olpnDetailSection) olpnDetailSection.style.display = 'none';
  if (deliverySection) deliverySection.style.display = 'block';
  selectedOlpnContext = null;
  if (Array.isArray(window._deliveryOlpns)) {
    renderOlpnCards(window._deliveryOlpns);
  }
});

updateConditionBtn?.addEventListener('click', () => {
  openConditionModal();
});

deliverBtn?.addEventListener('click', () => {
  deliverSelectedOlpn();
});

photoBtn?.addEventListener('click', openPhotoModal);
closePhotoBtn?.addEventListener('click', closePhotoModal);
capturePhotoBtn?.addEventListener('click', capturePhoto);
retakePhotoBtn?.addEventListener('click', retakePhoto);
uploadPhotoBtn?.addEventListener('click', uploadCapturedPhoto);

conditionCancelBtn?.addEventListener('click', closeConditionModal);
conditionApplyBtn?.addEventListener('click', () => {
  applySelectedCondition();
});

// Error modal close button
errorModalCloseBtn?.addEventListener('click', hideErrorModal);

// Close error modal when clicking outside
errorModal?.addEventListener('click', (e) => {
  if (e.target === errorModal) {
    hideErrorModal();
  }
});

// Theme selector
themeSelectorBtn?.addEventListener('click', openThemeModal);

// Close theme modal on backdrop click
modalBackdrop?.addEventListener('click', () => {
  if (isModalVisible(themeModal)) {
    closeThemeModal();
  }
  if (isModalVisible(conditionModal)) {
    closeConditionModal();
  }
});

// Close camera on background click
cameraModal.addEventListener('click', (e) => {
  if (e.target === cameraModal) {
    closeCamera();
  }
});

// Close photo modal on background click
photoModal?.addEventListener('click', (e) => {
  if (e.target === photoModal) {
    closePhotoModal();
  }
});

// Handle browser back button - intercept when camera modal is open
window.addEventListener('popstate', (event) => {
  // If camera modal is open and user pressed back button, close the modal instead
  if (cameraModal.classList.contains('active')) {
    // User pressed back while modal is open - close modal instead of navigating
    // Don't call closeCamera() here because it will try to clean up history again
    // Just close the modal directly
    const interactiveElement = document.getElementById('interactive');
    stopBarcodeScanner().finally(() => {
      if (interactiveElement) interactiveElement.innerHTML = '';
    });
    cameraModal.classList.remove('active');
    cameraModalHistoryState = null;
    return;
  }
  
  // If the state was for our camera modal (but modal already closed), just clean up
  if (event.state && event.state.modal === 'camera') {
    cameraModalHistoryState = null;
  }
});

// App opened - send tracking event
window.addEventListener('load', async () => {
  loadTheme(); // Load saved theme
  
  // Track app opened with full metadata
  trackEvent('app_opened', {});
  
  // Check for auto-authenticate
  checkAutoAuth();
});

