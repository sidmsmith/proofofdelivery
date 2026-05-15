// api/validate.js
import fetch from 'node-fetch';

const USAGE_INGEST_URL = (process.env.MANHATTAN_USAGE_INGEST_URL || '').trim();
const USAGE_INGEST_SECRET = (process.env.MANHATTAN_USAGE_INGEST_SECRET || '').trim();
const APP_NAME = 'proofofdelivery';
const APP_VERSION = '1.2.1';

const AUTH_HOST = process.env.MANHATTAN_AUTH_HOST || "salep-auth.sce.manh.com";
const API_HOST = process.env.MANHATTAN_API_HOST || "salep.sce.manh.com";
const CLIENT_ID = process.env.MANHATTAN_CLIENT_ID || "omnicomponent.1.0.0";
const CLIENT_SECRET = process.env.MANHATTAN_SECRET;
const PASSWORD = process.env.MANHATTAN_PASSWORD;
const USERNAME_BASE = process.env.MANHATTAN_USERNAME_BASE || "sdtadmin@";

async function forwardUsageEvent(payload) {
  if (!USAGE_INGEST_URL) {
    console.warn('[usage] MANHATTAN_USAGE_INGEST_URL not set; event not recorded');
    return;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (USAGE_INGEST_SECRET) {
    headers.Authorization = `Bearer ${USAGE_INGEST_SECRET}`;
  }
  try {
    await fetch(USAGE_INGEST_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[usage] Forward failed:', e.message || e);
  }
}

// Get OAuth token
async function getToken(org) {
  const url = `https://${AUTH_HOST}/oauth/token`;
  const username = `${USERNAME_BASE}${org.toLowerCase()}`;
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password: PASSWORD
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    },
    body
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

// API call wrapper
async function apiCall(method, path, token, org, body = null) {
  const url = `https://${API_HOST}${path}`;
  // Convert org to uppercase for API consistency (as used in other apps)
  const orgUpper = org ? org.toUpperCase() : org;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    selectedOrganization: orgUpper,
    selectedLocation: `${orgUpper}-DM1`
  };

  const res = await fetch(url, { 
    method, 
    headers, 
    body: body ? JSON.stringify(body) : undefined 
  });
  
  // Try to parse as JSON first, fallback to text
  const text = await res.text();
  let jsonResponse;
  try {
    jsonResponse = JSON.parse(text);
  } catch (e) {
    // If not JSON, return as text error
    return { error: text, success: false };
  }
  
  // Return the full response (success or error)
  return jsonResponse;
}

// Export handler
export default async function handler(req, res) {
  console.log(`[API] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, org: orgFromBody, shipmentId } = req.body;
  let org = orgFromBody;

  // === APP OPENED (NO ORG) ===
  if (action === 'app_opened') {
    // Track app opened event (metadata will be added by frontend)
    return res.json({ success: true });
  }

  // === USAGE TRACK (dashboard ingest → Neon) ===
  if (action === 'usage-track' || action === 'ha-track') {
    const { event_name, metadata } = req.body;
    const payload = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      event_name,
      app_name: APP_NAME,
      app_version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };
    await forwardUsageEvent(payload);
    return res.json({ success: true });
  }

  // === AUTHENTICATE ===
  if (action === 'auth') {
    const token = await getToken(org);
    if (!token) {
      return res.json({ success: false, error: "Auth failed" });
    }
    return res.json({ success: true, token });
  }

  // === Need token for secure actions ===
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "No token" });

  // === VALIDATE BARCODE / GET SHIPMENT ===
  if (action === 'validate_barcode') {
    if (!shipmentId) {
      return res.status(400).json({ success: false, error: "ShipmentId required" });
    }
    
    // Get org from request body (required for selectedOrganization header)
    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for barcode validation" });
    }

    const payload = {
      Query: `ShipmentId = '${shipmentId}'`,
      Size: 1
    };

    console.log('[validate_barcode] Request', JSON.stringify({ org: requestOrg, payload }, null, 2));
    const shipmentRes = await apiCall('POST', '/shipment/api/shipment/shipment/search', token, requestOrg, payload);
    console.log('[validate_barcode] Response', JSON.stringify(shipmentRes, null, 2));

    if (shipmentRes.error) {
      return res.json({ success: false, error: shipmentRes.error });
    }

    // Extract shipment data
    const shipment = shipmentRes.data && shipmentRes.data.length > 0 ? shipmentRes.data[0] : null;
    if (!shipment) {
      return res.json({ success: false, error: "Shipment not found" });
    }

    // Extract required fields
    const result = {
      success: true,
      shipmentId: shipment.ShipmentId,
      assignedCarrierId: shipment.AssignedCarrierId,
      trailerNumber: shipment.TrailerNumber,
      billOfLadingNumber: null,
      // Provide Stop list for Delivery -> Stops screen
      stops: Array.isArray(shipment.Stop)
        ? shipment.Stop.map((s) => ({
            StopId: s?.StopId ?? null,
            FacilityName: s?.FacilityName ?? null,
            FacilityId: s?.FacilityId ?? null,
            FacilityAddress: s?.FacilityAddress ?? null,
            StopSequence: s?.StopSequence ?? null,
            StopActionId: s?.StopActionId ? { StopActionId: s.StopActionId.StopActionId ?? null } : null
          }))
        : []
    };

    // Find Bill of Lading Number from Stop where StopActionId.StopActionId is "PU"
    if (shipment.Stop && Array.isArray(shipment.Stop)) {
      const pickupStop = shipment.Stop.find(stop => 
        stop.StopActionId && stop.StopActionId.StopActionId === "PU"
      );
      if (pickupStop && pickupStop.BillOfLadingNumber) {
        result.billOfLadingNumber = pickupStop.BillOfLadingNumber;
      }
    }

    return res.json(result);
  }

  // === SEARCH OLPNS FOR SHIPMENT (DELIVERY) ===
  if (action === 'search_olpns') {
    if (!shipmentId) {
      return res.status(400).json({ success: false, error: "ShipmentId required" });
    }

    // Get org from request body (required for selectedOrganization header)
    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for OLPN search" });
    }

    // Allow callers to request a larger page size (useful for stop-level rollups like "all delivered?")
    const sizeRaw = req.body.size ?? req.body.Size ?? null;
    let size = 200;
    if (sizeRaw !== null && sizeRaw !== undefined && String(sizeRaw).trim() !== '') {
      const n = Number(sizeRaw);
      if (Number.isFinite(n) && n > 0) size = Math.floor(n);
    }
    // Keep sane limits to avoid oversized responses
    size = Math.max(1, Math.min(size, 2000));

    const requestStopId = req.body.stopId || req.body.StopId || null;
    const stopIdValue = requestStopId ? String(requestStopId).trim() : '';
    const query = stopIdValue
      ? `ShipmentId= '${shipmentId}' and StopId= '${stopIdValue}' `
      : `ShipmentId= '${shipmentId}' `;

    const payload = {
      Query: query,
      Template: {
        ShipmentId: null,
        OlpnId: null,
        PK: null,
        LpnType: null,
        PalletId: null,
        ContainerTypeId: null,
        ContainerSizeId: null,
        EstimatedVolume: null,
        EstimatedWeight: null,
        // Needed for "Apply Condition" (so we can append if missing)
        OlpnCondition: [{ ConditionCodeId: null }],
        // Text field we treat like an array of ConditionCodeIds
        PODCondition: null,
        // Some tenants/models may expose this field with different casing
        PodCondition: null,
        podCondition: null,
        // Some environments store POD fields under Extended
        Extended: {
          PODDate: null,
          PODCondition: null,
          PODDriver: null,
          PODStatus: null,
          PONum: null
        }
      },
      Size: size,
      Page: 0
    };

    console.log('[search_olpns] Request', JSON.stringify({ org: requestOrg, payload }, null, 2));
    const olpnRes = await apiCall('POST', '/pickpack/api/pickpack/olpn/search', token, requestOrg, payload);
    console.log('[search_olpns] Response', JSON.stringify(olpnRes, null, 2));

    if (olpnRes?.error) {
      return res.json({ success: false, error: olpnRes.error });
    }

    const records = Array.isArray(olpnRes?.data) ? olpnRes.data : [];
    return res.json({ success: true, data: records });
  }

  // === DELIVER OLPNS ===
  // Updates OLPN using /pickpack/api/pickpack/olpn/save
  // - Extended.PODStatus: "DELIVERED"
  // - Extended.PODDate: current datetime (ISO)
  if (action === 'deliver_olpn') {
    const { olpnId, pk, podDate } = req.body;

    if (!olpnId || !pk) {
      return res.status(400).json({ success: false, error: "OlpnId and Pk are required" });
    }

    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for OLPN save" });
    }

    const payload = {
      OlpnId: String(olpnId),
      Pk: String(pk),
      Extended: {
        PODStatus: "DELIVERED",
        PODDate: podDate ? String(podDate) : new Date().toISOString()
      }
    };

    console.log('[deliver_olpn] Request', JSON.stringify({ org: requestOrg, payload }, null, 2));
    const saveRes = await apiCall('POST', '/pickpack/api/pickpack/olpn/save', token, requestOrg, payload);
    console.log('[deliver_olpn] Response', JSON.stringify(saveRes, null, 2));

    if (saveRes?.error) {
      return res.json({ success: false, error: saveRes.error });
    }

    // Most Manhattan endpoints return {success: boolean, ...}. If missing, treat as success.
    if (saveRes?.success === false) {
      return res.json({ success: false, error: JSON.stringify(saveRes) });
    }

    return res.json({ success: true, data: saveRes });
  }

  // === GET OLPN CONDITION CODES ===
  // GET /pickpack/api/pickpack/olpnConditionCode
  if (action === 'get_olpn_condition_codes') {
    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for condition codes" });
    }

    console.log('[get_olpn_condition_codes] Request', JSON.stringify({ org: requestOrg }, null, 2));
    const codesRes = await apiCall('GET', '/pickpack/api/pickpack/olpnConditionCode', token, requestOrg, null);
    console.log('[get_olpn_condition_codes] Response', JSON.stringify(codesRes, null, 2));

    if (codesRes?.error) {
      return res.json({ success: false, error: codesRes.error });
    }

    const records = Array.isArray(codesRes?.data) ? codesRes.data : [];
    return res.json({ success: true, data: records });
  }

  // === APPLY POD CONDITION (TEMP) ===
  // Updates OLPN via /pickpack/api/pickpack/olpn/save by setting PODCondition (comma-delimited)
  // Payload:
  // {
  //   OlpnId: "XXX",
  //   Pk: "YYY",
  //   PODCondition: "A,B,C"
  // }
  if (action === 'apply_pod_condition') {
    const { olpnId, pk, podCondition } = req.body;

    if (!olpnId || !pk) {
      return res.status(400).json({ success: false, error: "OlpnId and Pk are required" });
    }

    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for OLPN save" });
    }

    const payload = {
      OlpnId: String(olpnId),
      Pk: String(pk),
      PODCondition: podCondition ? String(podCondition) : ''
    };

    console.log('[apply_pod_condition] Request', JSON.stringify({ org: requestOrg, payload }, null, 2));
    const saveRes = await apiCall('POST', '/pickpack/api/pickpack/olpn/save', token, requestOrg, payload);
    console.log('[apply_pod_condition] Response', JSON.stringify(saveRes, null, 2));

    if (saveRes?.error) {
      return res.json({ success: false, error: saveRes.error });
    }

    if (saveRes?.success === false) {
      return res.json({ success: false, error: JSON.stringify(saveRes) });
    }

    return res.json({ success: true, data: saveRes });
  }

  // === UPLOAD SIGNATURE ===
  if (action === 'upload_signature') {
    const { shipmentId, filename, fileData, driver, timestamp } = req.body;
    
    if (!shipmentId || !filename || !fileData) {
      return res.status(400).json({ 
        success: false, 
        error: "ShipmentId, filename, and fileData are required" 
      });
    }

    // Get org from request body (required for selectedOrganization header)
    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ 
        success: false, 
        error: "ORG required for signature upload" 
      });
    }

    // Use timestamp from client (matches signature image timezone) or fallback to server time
    const driverName = driver || 'Unknown';
    let notes;
    
    if (timestamp) {
      // Client provided timestamp (already formatted with user's timezone)
      // Format: "MM/DD/YYYY, HH:MM:SS"
      notes = `${timestamp}, ${driverName}`;
    } else {
      // Fallback to server time if client timestamp not provided
      const now = new Date();
      const date = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const time = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      notes = `${date}, ${time}, ${driverName}`;
    }

    const payload = {
      ObjectTypeId: "Shipment",
      ObjectId: shipmentId,
      DocumentCategoryId: "DriverSignature",
      Action: "overWrite",
      Description: "Uploaded via API",
      DocumentManagerFiles: [
        {
          FileName: filename,
          DocumentName: "Driver Signature",
          Description: "Driver signature captured during pickup",
          Notes: notes,
          FileData: fileData
        }
      ]
    };

    // Log full payload (but truncate fileData for readability)
    const payloadForLog = {
      ...payload,
      DocumentManagerFiles: payload.DocumentManagerFiles.map(file => ({
        ...file,
        FileData: file.FileData ? `${file.FileData.substring(0, 50)}... (${file.FileData.length} chars)` : 'empty'
      }))
    };
    
    console.log('[upload_signature] Full Request Payload:', JSON.stringify(payloadForLog, null, 2));
    console.log('[upload_signature] Headers:', JSON.stringify({ 
      org: requestOrg, 
      orgUpper: requestOrg.toUpperCase(),
      selectedLocation: `${requestOrg.toUpperCase()}-DM1`
    }, null, 2));
    
    const uploadRes = await apiCall('POST', '/document-manager/api/document-manager/uploadDocuments', token, requestOrg, payload);
    console.log('[upload_signature] Full Response:', JSON.stringify(uploadRes, null, 2));

    // Check for error - Manhattan API returns success:false on error
    if (!uploadRes.success) {
      // Extract error message from Manhattan response structure
      let errorMsg = 'Document upload failed';
      if (uploadRes.message) {
        errorMsg = uploadRes.message;
      } else if (uploadRes.messages && uploadRes.messages.Message && uploadRes.messages.Message.length > 0) {
        errorMsg = uploadRes.messages.Message[0].Description || uploadRes.messages.Message[0].Code || errorMsg;
      } else if (uploadRes.error) {
        errorMsg = uploadRes.error;
      }
      
      // Include full response for troubleshooting
      const fullError = JSON.stringify(uploadRes);
      console.log('[upload_signature] Error Details:', fullError);
      
      return res.json({ 
        success: false, 
        error: fullError // Return full response for troubleshooting
      });
    }

    return res.json({ success: true, message: "Signature uploaded successfully" });
  }

  // === UPLOAD POD PHOTO (OLPN DETAILS CAMERA) ===
  // Uses same Document Manager upload endpoint as signature
  // - DocumentCategoryId: "podPhotos"
  // - Notes: <timestamp>, <olpnId>
  if (action === 'upload_pod_photo') {
    const { shipmentId, filename, fileData, olpnId, timestamp } = req.body;

    if (!shipmentId || !filename || !fileData) {
      return res.status(400).json({
        success: false,
        error: "ShipmentId, filename, and fileData are required"
      });
    }

    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({
        success: false,
        error: "ORG required for photo upload"
      });
    }

    let notes;
    if (timestamp) {
      notes = `${timestamp}, ${olpnId || ''}`.trim();
    } else {
      const now = new Date();
      const date = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const time = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      notes = `${date}, ${time}, ${olpnId || ''}`.trim();
    }

    const payload = {
      ObjectTypeId: "Shipment",
      ObjectId: shipmentId,
      DocumentCategoryId: "podPhotos",
      Action: "overWrite",
      Description: "Uploaded via API",
      DocumentManagerFiles: [
        {
          FileName: filename,
          DocumentName: "POD Photo",
          Description: "POD photo captured during delivery",
          Notes: notes,
          FileData: fileData
        }
      ]
    };

    const payloadForLog = {
      ...payload,
      DocumentManagerFiles: payload.DocumentManagerFiles.map(file => ({
        ...file,
        FileData: file.FileData ? `${file.FileData.substring(0, 50)}... (${file.FileData.length} chars)` : 'empty'
      }))
    };

    console.log('[upload_pod_photo] Full Request Payload:', JSON.stringify(payloadForLog, null, 2));

    const uploadRes = await apiCall('POST', '/document-manager/api/document-manager/uploadDocuments', token, requestOrg, payload);
    console.log('[upload_pod_photo] Full Response:', JSON.stringify(uploadRes, null, 2));

    if (!uploadRes.success) {
      return res.json({
        success: false,
        error: JSON.stringify(uploadRes)
      });
    }

    return res.json({ success: true, message: "Photo uploaded successfully" });
  }

  // === GET FACILITY DETAILS (FOR STOPS: CITY/STATE LOOKUP) ===
  // POST /facility/api/facility/facility/search
  // Payload (example):
  // {
  //   "Query": "FacilityId = SS-DEMO-Harrison",
  //   "Size": 1000,
  //   "Page": 0,
  //   "Template": { "FacilityId": null, "FacilityName": null, "FacilityAddress": null }
  // }
  if (action === 'get_facility') {
    const requestOrg = req.body.org;
    if (!requestOrg) {
      return res.status(400).json({ success: false, error: "ORG required for facility lookup" });
    }

    const facilityIdRaw = req.body.facilityId ?? req.body.FacilityId ?? null;
    const facilityId = facilityIdRaw ? String(facilityIdRaw).trim() : '';
    if (!facilityId) {
      return res.status(400).json({ success: false, error: "FacilityId required" });
    }

    const payload = {
      Query: `FacilityId = ${facilityId}`,
      Size: 1000,
      Page: 0,
      Template: {
        FacilityId: null,
        FacilityName: null,
        FacilityAddress: null
      }
    };

    console.log('[get_facility] Request', JSON.stringify({ org: requestOrg, payload }, null, 2));
    const facRes = await apiCall('POST', '/facility/api/facility/facility/search', token, requestOrg, payload);
    console.log('[get_facility] Response', JSON.stringify(facRes, null, 2));

    if (facRes?.error) {
      return res.json({ success: false, error: facRes.error });
    }

    const record = Array.isArray(facRes?.data) && facRes.data.length > 0 ? facRes.data[0] : null;
    return res.json({ success: true, data: record, header: facRes?.header ?? null });
  }

  // Unknown action
  return res.status(400).json({ error: "Unknown action" });
}

export const config = { api: { bodyParser: true } };

