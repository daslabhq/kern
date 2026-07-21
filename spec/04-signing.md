# Kern agent signing (v0.1, draft)

## Goal

Make it possible for a runtime (Korn, or any embedder of Kern) to
**verify the publisher** of an arbitrary blob — typically an agent
file, but the format is content-agnostic — before granting it elevated
capabilities.

This is the primitive that lets us have a "trusted publishers" model
without an app store: anyone can publish a signed artifact, and any
user can decide whose signatures their runtime treats as trustworthy.

## Signed envelope

A Kern-signed artifact is wrapped in an envelope:

```
kern-signed/v1
sig: <base64url ed25519 signature>
key: <issuer pubkey, "did:key:..." or "npub1...">
ts:  <unix issue time>
typ: <content type, e.g. "application/x-korn-agent">

<raw payload bytes>
```

The first line is a magic marker; subsequent header lines are
`key: value` separated by `\n`; a single blank line separates headers
from payload. The payload is **raw bytes** — no encoding, no escaping.

The signature covers the canonical SHA-256 of:
- the literal string `"kern-signed/v1\n"`
- the sorted header lines `key: value\n` (excluding the `sig:` line itself)
- a single `\n`
- the raw payload bytes

Verification:
```c
int kern_sigenv_verify(const uint8_t *envelope, size_t envelope_len,
                       const char *trusted_pubkey,    /* NULL to accept any */
                       uint8_t **payload_out, size_t *payload_len_out,
                       char **issuer_out, int64_t *ts_out);
```

Returns 0 on success. The payload is exposed to the caller; if the
caller passes `NULL` for `trusted_pubkey`, verification still happens
(signature validity is checked) but no trust decision is made — the
caller is told who signed and decides from there.

## Multiple signatures

A single artifact may carry multiple signatures (an author and a
counter-signer, for instance). Format:

```
kern-signed/v1
sig:  <signature1>
key:  <pubkey1>
sig:  <signature2>
key:  <pubkey2>
ts:   <unix issue time>
typ:  application/x-korn-agent

<payload>
```

The header parser pairs `sig:` and `key:` in document order. Each
signature must independently verify against its paired key.

## Trust model in the runtime

Kern itself does not decide trust. It exposes verification + provides
the `publisher:trust` capability vocabulary (see spec 03). The runtime
embedding Kern decides:

1. Load envelope, call `kern_sigenv_verify` with `NULL` trusted_pubkey.
2. If signature is valid, extract `issuer`.
3. Look up self-issued capability: do I have
   `publisher:<issuer>::publisher/trust` active?
4. If yes: load payload with full runtime privileges.
5. If no, but `publisher:<issuer>::publisher/sandbox` exists: load
   sandboxed (no `secrets`, no `wallet`, no `device`, capped resource
   usage).
6. If no trust capability exists: refuse to load, or sandbox by default,
   per runtime policy.

This gives runtimes a uniform "should I trust this thing?" decision.

## Korn-specific: signing `.korn` agent files

When Korn loads an agent file, it expects either:

- a **raw** `.korn` file (Lua source) — loaded into a sandbox unless
  the user explicitly bypasses
- a **signed** `.korn` file (kern-signed envelope with `typ:
  application/x-korn-agent`) — runs at the privilege level granted
  by the publisher trust capability

```bash
korn agent sign mybot.korn          # produces mybot.korn.signed
korn agent verify mybot.korn.signed # prints publisher, asks if trusted
korn agent install mybot.korn.signed --trust  # adds publisher to trust list
```

## Compatibility with existing standards

This signed-envelope format is a thin layer over a JWS-shaped concept,
chosen for human-readability and tooling simplicity. We considered:

- **JWS** (RFC 7515) — works but verbose; binary payloads need base64
- **Sigstore bundle** — overkill; designed for software supply chain
  with transparency logs
- **minisign** — close in spirit, simpler than ours, but lacks
  multi-signer; we may adopt its format in v1 if multi-sig is rare
- **SSH signatures** (`ssh-keygen -Y sign`) — uses Ed25519 like us but
  encoding is RFC 4251-flavored, less portable

Kern's envelope is intentionally simple. v1 will offer a JWS adapter
for ecosystems that need it (e.g., npm package signing).

## Open

- Bundle format for multi-file agents (an agent + its WASM modules + its
  asset blobs) — tar+sign vs. directory+manifest?
- Transparency log integration (Sigstore Rekor) for tamper-evident
  publisher history — opt-in in v1?
- Counter-signing UI flow — how the runtime asks the user "do you
  want to also sign this before installing?"
