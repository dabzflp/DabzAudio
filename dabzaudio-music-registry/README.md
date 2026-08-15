# DabzAudio Music ID — MVP

A standalone, embeddable music registration and verification service for DabzAudio.

The MVP does four things:

1. Accepts an audio upload.
2. Creates a SHA-256 fingerprint of the exact uploaded file.
3. Stores music metadata and ownership splits in MongoDB.
4. Optionally anchors the fingerprint + Music ID on a Polygon-compatible EVM blockchain.

## Important architecture decision

The actual audio file is NOT permanently stored by this MVP.

Railway containers use ephemeral local storage, so the upload is temporarily written to disk only long enough to calculate the hash and is then deleted.

For production, add object storage such as S3/R2/Cloudinary if you want DabzAudio to retain masters, stems or licence files.

## Stack

- Node.js
- Express
- MongoDB Atlas
- Multer
- Ethers v6
- HTML/CSS/Vanilla JavaScript
- Solidity
- Railway-ready

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:3000/registry
```

Health check:

```text
http://localhost:3000/health
```

## MongoDB

Create a MongoDB Atlas database and add:

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=dabzaudio_registry
```

If MongoDB is not configured, the API can still start, but registration records will not persist.

## Railway

Create a Railway service from this repository.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Add Railway variables:

```env
MONGODB_URI=...
MONGODB_DB=dabzaudio_registry
APP_BASE_URL=https://your-railway-domain.up.railway.app
BLOCKCHAIN_ENABLED=false
```

## Blockchain

The smart contract is in:

```text
contracts/DabzAudioMusicRegistry.sol
```

The initial implementation is intentionally simple.

It stores:

- audio SHA-256 hash
- DabzAudio Music ID
- metadata URI
- registrar wallet
- blockchain timestamp

Deploy it to a testnet first.

Recommended development target:

```text
Polygon Amoy
Chain ID: 80002
```

Then set:

```env
BLOCKCHAIN_ENABLED=true
RPC_URL=...
CHAIN_ID=80002
REGISTRY_CONTRACT_ADDRESS=0x...
REGISTRY_PRIVATE_KEY=...
```

### Security

Never commit `.env`.

Never expose `REGISTRY_PRIVATE_KEY` to the browser.

For production, use a dedicated low-balance registrar wallet and consider moving signing to a managed key-management service.

## API

### Register

```http
POST /api/registry/register
Content-Type: multipart/form-data
```

Fields:

```text
audio       File
title       String
artist      String
producer    String
isrc        String
genre       String
ownership   JSON string
contributors JSON string
```

Example ownership:

```json
[
  {
    "name": "Artist",
    "role": "Artist",
    "percentage": 60
  },
  {
    "name": "Producer",
    "role": "Producer",
    "percentage": 40
  }
]
```

### Lookup

```http
GET /api/registry/:musicId
```

### Public verification

```text
/music-id/:musicId
```

## Embedding into DabzAudio

The registry intentionally has NO DabzAudio homepage.

The standalone registration interface can be placed inside a DabzAudio card, modal or dashboard.

Simple iframe:

```html
<iframe
    src="https://YOUR-RAILWAY-DOMAIN/registry"
    title="DabzAudio Music ID"
    style="width:100%; min-height:900px; border:0;"
    loading="lazy">
</iframe>
```

For a tighter integration, copy the card HTML/CSS/JS into the existing DabzAudio frontend and point the form at:

```text
/api/registry/register
```

## What comes next

This MVP is the foundation, not the final rights platform.

Recommended next layers:

1. DabzAudio account authentication.
2. Artist-owned Music IDs.
3. Contributor invitation links.
4. Contributor approval/signatures.
5. Validated ownership splits that must equal 100%.
6. ISRC/metadata validation.
7. Audio fingerprint matching across uploads.
8. Public QR verification.
9. Licence generation.
10. Beat/stem licensing marketplace.
11. Royalty ledger.
12. Distributor/label API.
13. User-owned wallets as an optional advanced feature.
14. Production blockchain batching to reduce transaction costs.

## Legal/product note

A blockchain timestamp or hash is evidence of a recorded digital state. It does not, by itself, determine legal copyright ownership.

Use signed agreements, contributor confirmations and appropriate copyright/licensing terms for legal rights.
