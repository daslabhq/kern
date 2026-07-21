# 05 — Audit log

Status: draft `v0.1`. Adopted from the Daslab Wallet prototype
([daslabhq/wallet](https://github.com/daslabhq/wallet), now archived), which
carries the reference implementation in `src/audit/` and `src/crypto/`.
Porting that implementation into this repository is planned but not done.

## Why

Kern's promise is *used, never seen*: agents exercise credentials without
holding them. That only means something if the user can later verify exactly
what was done in their name. The audit log is that proof — an append-only,
hash-chained, receipt-signed record of every credentialed call the Kern
runtime executes. Change any past entry and either the chain breaks or the
signature fails.

## Entry

One entry per credentialed call. An entry is the payload (what the caller
intended) plus chain and receipt fields (added at append time).

Payload fields:

| Field | Meaning |
| --- | --- |
| `ts` | ISO-8601 timestamp |
| `app_id`, `user` | who asked |
| `provider`, `tool`, `scope[]` | what was exercised |
| `where` | execution node, upstream provider + region, credential origin (`personal` / `org` / `service`), routing reason (`default` / `cheapest` / `nearest` / `policy`) |
| `usage` | optional: model, input/output tokens |
| `duration_ms`, `upstream_cost_cents` | cost of the call |
| `args_hash`, `response_hash` | content commitments — the log proves *what* was sent without storing it |

Chain and receipt fields, filled in by the runtime on append:

| Field | Meaning |
| --- | --- |
| `seq` | 0-based position in the log |
| `prev_hash` | `this_hash` of the previous entry; genesis uses 64 zero chars |
| `this_hash` | hash over the payload + `seq` + `prev_hash` |
| `receipt_sig` | ed25519 signature over `this_hash` by the runtime's key |

## Properties

- **Tamper-evident**: entries are hash-chained; truncation or edit breaks
  every subsequent `prev_hash`.
- **Non-fabricable**: `receipt_sig` binds each entry to the runtime that
  executed the call. Anyone with the runtime's public key can verify an
  entry with no other context.
- **Private by construction**: arguments and responses appear only as
  hashes. The user can prove a call matched known content; the log alone
  leaks neither.
- **User-owned**: the log lives with the user's Kern vault (02-vault.md),
  not with a provider.

## Keys

v0.1 uses a single runtime keypair (the identity keys of 01-identity.md
apply). Later revisions add per-tool / per-org / per-region signers, with a
`signer_pubkey` field on the entry recording which key signed it.
