# DabzAudio Music ID — Product Architecture

## Core proposition

DabzAudio gives every recording a persistent identity.

The identity is based on the exact audio file hash plus structured metadata.

## Flow

Artist
→ upload recording
→ DabzAudio calculates SHA-256
→ create Music ID
→ store metadata
→ optionally anchor hash on blockchain
→ generate public verification URL

## Why hash the audio?

A SHA-256 hash changes if the underlying file changes.

That means the system can distinguish:

- original master
- edited master
- new export
- remaster
- different file

For a future production system, add perceptual audio fingerprinting as a separate layer. SHA-256 alone is not suitable for identifying audio that has been transcoded or slightly modified.

## Revenue model

### Registration

Charge for premium registration.

### Verification

Charge labels, publishers and platforms for bulk verification.

### Licensing

Take a percentage from beat, stem and sync licences.

### API

Offer verification and rights metadata through a paid API.

### Enterprise

Provide catalogue ingestion and rights tooling to labels and publishers.

## Long-term data model

music
contributors
ownership_splits
registrations
audio_fingerprints
licenses
royalty_events
blockchain_transactions
organizations
api_keys
audit_events

## Key rule

Blockchain should be an integrity layer.

MongoDB should be the application database.

Object storage should hold files.

The public blockchain should not be used as the primary database or as the place to store audio.
