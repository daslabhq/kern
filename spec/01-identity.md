# Kern identity (v0.1, draft)

## One seed, three roles

A Kern identity is a single BIP-39 mnemonic (24 words by default; 12
permitted) from which three keypairs are deterministically derived:

| Role | Curve | Used for |
|---|---|---|
| **identity** | Ed25519 | signing agent files, signing capability tokens, mesh peer-id |
| **wallet** | secp256k1 (root) | payments (Bitcoin, EVM, Tron — chain-specific addresses derived per BIP-44) |
| **age** | X25519 | vault decryption |

A user holds one mnemonic. From it, every key Kern ever needs is
recovered. **Backup the mnemonic, backup everything.**

## Derivation

We follow BIP-39 + SLIP-0010 with the following purpose codes:

```
m / purpose'
    ├── 44'    BIP-44 wallet (per-chain coin types: 60' EVM, 195' Tron, 0' BTC, 501' Solana)
    ├── 1237'  Nostr-style identity Ed25519 (NIP-06 convention)
    └── 7654'  Kern X25519 age key  (assigned for Kern; informational, not registered)
```

For v0.1, only the identity (1237') and age (7654') paths are required.
Wallet derivation is out of scope for Kern itself — wallet implementations
read the seed and derive per BIP-44 standard paths.

### Identity key (Ed25519)

Derived per NIP-06:
```
seed              = bip39.seed_from_mnemonic(mnemonic, passphrase="")
m_root            = slip10.from_seed("ed25519 seed", seed)   /* SLIP-0010 master */
identity_priv     = m_root.derive("m/44'/1237'/0'/0/0").privkey
identity_pub      = ed25519.public(identity_priv)
identity_address  = "npub1" + bech32(identity_pub)           /* Nostr npub format */
```

### Age key (X25519)

```
m_root            = slip10.from_seed("ed25519 seed", seed)
age_priv_raw      = m_root.derive("m/44'/7654'/0'/0/0").privkey
age_priv          = "AGE-SECRET-KEY-1" + bech32(age_priv_raw)
age_pub           = age.x25519_to_recipient(age_priv_raw)   /* "age1..." */
```

The age public key is what gets listed in `.recipients`. The private key
never leaves the Kern process unless explicitly exported by the user.

## Optional passphrase

BIP-39 supports a 25th word (passphrase). Kern honors this — opening the
same mnemonic with a different passphrase produces a different identity.
Useful for plausible deniability and for splitting personas. Passphrase
is not stored anywhere; user must remember it.

## Multiple identities

A single Kern instance may hold multiple identities (e.g., personal +
work). The C API takes an identity handle for every operation; default
identity is "active" until changed.

```c
kern_t *k = kern_open_from_seed(personal_mnemonic, "");
kern_identity_handle work = kern_identity_add(k, work_mnemonic, "");
kern_identity_use(k, work);     /* subsequent calls use 'work' */
```

## Public format

When written down or transmitted, identity pubkeys use Nostr-compatible
bech32 ("npub1..."). Vault age pubkeys use age's bech32 ("age1...").
This lets users copy/paste keys into existing tools (Nostr clients,
age-cli, sops) without conversion.

```
identity      npub1abc...        Ed25519 public, 32 bytes
age recipient age1xyz...         X25519 public,  32 bytes
```

For interop with W3C DIDs:
```
did:key:zA1B...        encodes the same Ed25519 pubkey as identity
```
Kern emits `did:key:` strings on demand for compatibility with UCAN
implementations that expect them.

## Backup and recovery

The only artifact a user must back up is the 24-word mnemonic. Suggested
storage:

- **Paper backup**, kept offline. Reference implementation prints a
  formatted card.
- **Hardware key escrow** (YubiKey, Trezor) for higher-stakes users.
- **Social recovery** (k-of-n shamir-shared shards distributed to
  trusted peers) — Kern v0.2 or later.

Kern v0.1 does not implement social recovery. The data structures for
shamir sharding are reserved (path `m/44'/7654'/1'/...`) and will be
added in v0.2.

## Security properties

- **Forward secrecy**: none at this layer. Compromise of the mnemonic =
  compromise of all derived keys, past and future. Forward secrecy must
  be added at the transport layer (mesh, p2p) if needed.
- **Plausible deniability**: via passphrase; user can claim a different
  passphrase reveals a different (decoy) identity.
- **Quantum resistance**: none. Ed25519 and X25519 are vulnerable to
  sufficiently large quantum computers. Kern v2 will add PQ-hybrid
  identity (ML-DSA-65 + Ed25519 dual-sign, ML-KEM-768 + X25519 dual-wrap).

## Open

- Should Kern enforce per-purpose path separation strictly, or allow
  user-defined derivation paths?
- BIP-39 passphrase — make required or optional? (Trade-off: stronger
  default vs. usability.)
