# Proof of Delivery App

Proof of delivery application for truck drivers to scan barcodes, view shipment information, and capture digital signatures.

## Features

- **Barcode Scanning**: Manual entry or camera-based scanning using QuaggaJS
- **Shipment Validation**: Validates barcode against Manhattan WMS Shipment API
- **Pickup / Delivery Flow**: After shipment entry, choose **Pickup** or **Delivery**
- **Pickup Proof**: Shipment details + digital signature upload to Document Manager
- **Delivery Proof**:
  - Stops page with delivery-only stops (DL) and stop-based oLPN filtering
  - List oLPNs for a shipment via `/pickpack/api/pickpack/olpn/search`
  - Pallet grouping + expandable pallet cards (with underlying oLPN visibility)
  - oLPN detail screen (oLPN, Status (PODStatus), container type/size, estimated volume/weight)
  - Deliver button updates POD fields (and temporarily legacy fields)
  - Apply/remove condition codes stored in `Extended.PODCondition` (displayed as removable chips)
  - Photo capture + upload to Document Manager (category `podPhotos`)

## Setup

### Environment Variables (Vercel)

Set the following environment variables in Vercel:

- `MANHATTAN_PASSWORD` - Manhattan WMS password
- `MANHATTAN_SECRET` - Manhattan OAuth client secret

### Local Development

```bash
npm install
npm run dev
```

### Deployment

The app is configured for Vercel deployment. Push to GitHub and connect to Vercel.

## API Endpoints

- `POST /api/validate` - Main API endpoint
  - `action: 'app_opened'` - Track app usage
  - `action: 'auth'` - Authenticate with ORG
  - `action: 'validate_barcode'` - Validate shipment barcode
  - `action: 'search_olpns'` - Search oLPNs for a shipment (Delivery)
  - `action: 'deliver_olpn'` - Mark oLPN delivered (updates POD fields)
  - `action: 'get_olpn_condition_codes'` - Load condition code list for modal
  - `action: 'apply_pod_condition'` - Update `Extended.PODCondition`
  - `action: 'upload_signature'` - Upload driver signature to Document Manager
  - `action: 'upload_pod_photo'` - Upload POD photo to Document Manager (`DocumentCategoryId="podPhotos"`)

## Usage

1. Enter ORG and authenticate (or use `?Organization=XXX` URL parameter for auto-auth)
2. Enter or scan barcode/shipment ID
3. Choose **Pickup** or **Delivery**
4. **Pickup**: review shipment info, sign, and confirm pickup (uploads signature)
5. **Delivery**: select an oLPN, apply/remove condition codes, capture photo, and upload

## Release Notes (v1.2.0)

This release memorializes major Delivery workflow enhancements after v1.1.x, including **Stop Cards** and **Pallet** behavior.

- **Stops (Delivery)**
  - Added a Stops page after clicking **Delivery**, displaying Stop cards (StopId + FacilityName)
  - Stops list is filtered to **Stop Action = "DL"**
  - If there is exactly one DL stop, the Stops page is bypassed and Delivery opens immediately
  - Delivery oLPN search is filtered by **ShipmentId + StopId**
  - Back navigation adapts based on whether Stops were shown or bypassed
- **Pallet-aware Delivery list**
  - Distinct icons for standard oLPNs vs pallet records (pallet-with-boxes composite icon)
  - Palletized oLPNs (PalletId populated) are grouped under their parent pallet card (not shown as separate top-level cards)
  - Pallet cards support expand/collapse to show underlying oLPNs (read-only visibility)
  - Long IDs are formatted to preserve right-most digits on mobile (ellipsis on the left)
- **Pallet cascade actions**
  - When a pallet is selected, **Deliver**, **Apply Condition**, and **Remove Condition** cascade to the pallet record and all child oLPNs
  - Child matching is robust (case-insensitive PalletId comparisons; uses LpnType='PALLET' for pallet detection)
- **Version display**
  - Updated browser tab title and header version display to reflect v1.2.0

## Release Notes (v1.1.0)

This release memorializes the major updates through the initial Delivery workflow and photo upload support. **This is intentionally before we add a Shipment Stop screen.**

- **Navigation & UX**
  - Added the Pickup/Delivery card chooser after shipment validation
  - Back buttons aligned to the top-right (consistent across screens)
  - After pickup signature confirmation, returns to the card screen (not the shipment prompt)
  - URL parameters supported for `Organization/ORG` and `ShipmentId/Shipment`
- **Delivery (oLPN) workflow**
  - Shipment-based oLPN list with delivered vs not-delivered icon status (via `Extended.PODStatus`)
  - oLPN detail screen with requested fields and null-safe display
  - Deliver action updates `Extended.PODStatus="DELIVERED"` and `Extended.PODDate` (legacy fields still updated temporarily)
  - Condition code modal populated from `/pickpack/api/pickpack/olpnConditionCode` and sorted by Description
  - Apply/remove condition codes persisted in `Extended.PODCondition` and rendered as removable chips
- **Proof assets**
  - Signature upload via Document Manager (category `DriverSignature`)
  - Photo capture + upload via Document Manager (category `podPhotos`, filename `PODPhoto_<OlpnId>.jpg`)

## Notes

- Signature Save and Download are currently separate buttons for testing purposes
- Will eventually be combined into a single action
- Signatures are currently stored client-side only (may change in future)





























