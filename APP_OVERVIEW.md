# Proof of Delivery (POD) App — Overview

This document explains the end-to-end user experience of the Proof of Delivery application. It is intentionally **high-level** and does **not** include any API/endpoint details.

## What this app is for

The POD app is a simple, mobile-friendly workflow for drivers to:

- Validate a shipment
- Capture proof for **Pickup** (driver signature)
- Capture proof for **Delivery** (stop selection, oLPN/pallet status, delivery actions, photos, and condition codes)

## Main screens and flow

### 1) Authenticate + enter shipment

- The user enters an **ORG** and authenticates.
- The user scans or types a **Shipment ID**.
- After a successful validation, the app shows the **Pickup** and **Delivery** cards.

### 2) Pickup and Delivery cards

The two cards represent the two workflows the driver can perform for the validated shipment:

- **Pickup**
  - Opens Shipment Information (read-only fields + driver name) and the Digital Signature area.
  - When the driver confirms pickup, the signature is uploaded and the app returns to the Pickup/Delivery card screen.

- **Delivery**
  - Opens the Delivery workflow starting at the **Stops** screen (or bypasses it if there is only one Delivery stop).

## Delivery workflow: Stops + Delivery list

### Stops screen

When Delivery is selected, the app shows a list of **Stop cards** for the shipment (Delivery stops only).

Each Stop card shows:

- **Stop ID**
- **Facility display**
  - If a facility name exists: `Facility Name: City, State`
  - If a facility name is missing: `City, State`

#### Stop card icon color coding (green/red)

Each Stop card has a location icon whose color reflects delivery completion for that stop:

- **Green**: **ALL** oLPNs for that Stop are **DELIVERED**
- **Red**: At least one oLPN for that Stop is **not** delivered (or the stop has no oLPNs)

If there is only one Delivery stop, the app skips the Stops screen and goes directly to the Delivery list.

### Delivery screen (oLPN list)

After selecting a stop, the app shows the Delivery list for that stop.

- Each card represents either:
  - A standard **oLPN** (box icon), or
  - A **Pallet record** (pallet-with-boxes icon)
- Icon colors follow the same concept as Stops:
  - **Green**: delivered
  - **Red**: not delivered

#### Pallet grouping and expansion

If oLPNs are palletized:

- The pallet record appears as a single main card.
- Child oLPNs are not shown as separate top-level cards.
- The pallet card can be expanded to show a read-only list of its child oLPNs for visibility.

## oLPN Details screen actions

Selecting an oLPN (or pallet) opens the Details screen and shows key attributes plus three main actions:

### Apply Condition

- Opens a modal where the user selects a single **Condition Code**.
- When applied, the chosen code is stored on the oLPN and immediately displayed under **Condition Codes** as a removable chip.
- Removing a chip removes that code from the oLPN and refreshes the display immediately.

**Pallet behavior**:

- If the selected record is a pallet, Apply/Remove Condition is applied to:
  - the pallet record **and**
  - all child oLPNs on that pallet

### Deliver

- Marks the selected oLPN as delivered and updates the on-screen Status.
- The Delivery list icons will reflect the delivered state.

**Pallet behavior**:

- If the selected record is a pallet, Deliver is applied to:
  - the pallet record **and**
  - all child oLPNs on that pallet

### Camera (photo capture)

- Opens a photo capture modal (live camera preview).
- The user can capture, preview, retake, and upload the photo.
- Photos are stored as proof assets tied to the shipment and annotated with the oLPN.

**Note**: Photo capture does not cascade from pallet to children; it applies to the currently selected record.

