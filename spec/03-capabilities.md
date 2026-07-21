# Kern capabilities (v0.1, draft)

## Concept

A **capability** is a signed assertion from one identity (issuer) to
another (audience) of the form:

> *"The holder of audience-pubkey is permitted to perform action `X`
> on resource `Y`, with constraints Z, until time T, attested by my
> signature."*

This is exactly the [UCAN](https://ucan.xyz/) primitive. Kern uses UCAN
1.0 as the wire format, with a Kern-specific *capability vocabulary*
(the set of actions/resources we recognize).

By design, capabilities cover **every** form of "X can do Y" in a
Kern-using system:

- secret access (`secrets:get:openai_api_key`)
- tool execution (`tool:exec:web_search`)
- repo write (`repo:push:notes`)
- wallet spend (`wallet:spend:USDC@base:5usd:per-day`)
- device control (`device:unlock:front-door`)
- publisher trust (`publisher:trust:@anthropic`)

The same primitive everywhere. One verifier, one revocation model, one
audit log.

## Wire format

Kern uses UCAN 1.0 (canonical signed JSON, ed25519 signatures). A token
is a compact base64url string, three dot-separated segments:

```
<header>.<payload>.<signature>
```

Decoded header:
```json
{ "alg": "EdDSA", "ucv": "1.0.0", "typ": "JWT" }
```

Decoded payload (Kern profile):
```json
{
  "iss":  "did:key:zAbc...",                  /* issuer pubkey */
  "aud":  "did:key:zXyz...",                  /* audience pubkey */
  "att":  [ { "with": "secrets:openai_api_key",
              "can":  "secrets/get" } ],      /* attenuations */
  "exp":  1747843200,                         /* unix expires */
  "nbf":  1747843200,                         /* not before */
  "nnc":  "abc123",                           /* nonce */
  "prf":  [ ]                                 /* proofs (delegation chain) */
}
```

`<signature>` is ed25519 over `<header>.<payload>` using the issuer's
identity key.

We defer to UCAN-1.0 for: signature verification, expiration semantics,
delegation chains (prf), and revocation lists. We **add** the Kern
capability vocabulary.

## Kern capability vocabulary

A capability has two parts: `with` (the resource URI) and `can` (the
verb). Vocabulary registry (v0.1):

```
SECRETS
  with: secrets:<name>
  can:  secrets/get        — decrypt and return plaintext
  can:  secrets/put        — write/overwrite
  can:  secrets/delete

TOOLS (Korn-specific but in Kern's vocabulary)
  with: tool:<name>
  can:  tool/call

REPOS (Korn-specific)
  with: repo:<name>
  can:  repo/pull
  can:  repo/push

WALLET
  with: wallet:<chain>:<asset>            /* e.g. wallet:base:USDC */
  can:  wallet/spend                      /* with constraints below */

DEVICE (host-defined)
  with: device:<peer-pubkey>:<resource>
  can:  device/call

PUBLISHER (trust)
  with: publisher:<pubkey>
  can:  publisher/trust                   /* full permissions for their signed agents */
  can:  publisher/sandbox                 /* sandbox only */
```

Each attenuation may carry constraints. Common constraints:

```json
{ "with": "wallet:base:USDC",
  "can":  "wallet/spend",
  "nb": {                                 /* nb = non-normative bag */
    "max": "5",
    "per": "day",
    "memo_required": true
  } }
```

`nb` (non-normative bag) is per-resource. Verifiers must enforce known
constraints; unknown constraints in `nb` should cause refusal unless
the verifier knows they're advisory.

## Issuance

```c
char *kern_cap_issue(kern_t *k,
                     const char *audience_pubkey,
                     const char *capability,        /* "with::can" form */
                     int64_t expires_unix);
```

Example:
```c
char *token = kern_cap_issue(
    k,
    "did:key:zXyz...",
    "secrets:openai_api_key::secrets/get",
    time(NULL) + 3600
);
/* send `token` to the audience */
free(token);
```

For richer issuance (multiple attenuations, constraints, delegation
chains), use the structured form:
```c
kern_cap_builder *b = kern_cap_builder_new(k);
kern_cap_builder_audience(b, "did:key:zXyz...");
kern_cap_builder_attenuation(b, "wallet:base:USDC", "wallet/spend",
                             "{\"max\":\"5\",\"per\":\"day\"}");
kern_cap_builder_expires(b, time(NULL) + 3600);
char *token = kern_cap_builder_sign(b);
kern_cap_builder_free(b);
```

## Verification

```c
int kern_cap_verify(const char *token,
                    const char *expected_audience,
                    const char *expected_capability);
```

Returns 0 on success. Failure modes (negative return codes):
- `KERN_CAP_EXPIRED`
- `KERN_CAP_BAD_SIGNATURE`
- `KERN_CAP_AUDIENCE_MISMATCH`
- `KERN_CAP_CAPABILITY_NOT_GRANTED`
- `KERN_CAP_REVOKED`
- `KERN_CAP_CONSTRAINT_VIOLATED`

For attenuation / delegation chains, verifiers must walk the `prf`
chain back to a root issuer the verifier trusts. Trust roots are
host-configured.

## Revocation

UCAN supports revocation via signed revocation tokens. Kern follows the
standard: an issuer publishes a revocation citing the token's signature
hash; verifiers consult a revocation store before accepting.

Kern's default revocation store is a local file `revocations.log`. In
mesh setups, revocations are gossiped over the same transport as
capability issuance.

## Audit

Every `kern_cap_verify` writes a structured local audit entry:

```
ts=...  issuer=did:key:...  audience=did:key:...  capability=...  result=ok|...
```

Stored in `~/.kern/audit.log` by default (configurable). Format is
append-only JSON-lines.

## Use cases mapped to capabilities

### Secret share between two devices (same user)
```
issuer = my_mac.identity
audience = my_iphone.identity
capability = secrets:openai_api_key::secrets/get
expires = +1y
```

### Server-side decryption of vault entries
```
issuer = me.identity
audience = render_server.identity
capability = secrets:*::secrets/get      /* glob: all secrets */
expires = +30d                            /* short — rotate often */
```

### Granting a peer agent budgeted spend
```
issuer = me.identity
audience = friend.identity
capability = wallet:base:USDC::wallet/spend
nb = { "max": "1", "per": "day" }
expires = +7d
```

### Trusting a publisher's signed agents
```
issuer = me.identity
audience = me.identity                    /* self-issued */
capability = publisher:did:key:zAnthropic...::publisher/trust
expires = +1y
```

This is how the "trusted publisher" list is implemented — it's just a
set of self-issued capabilities the runtime consults before loading
an agent.

## Why UCAN and not OAuth / macaroons / etc.

| Property | UCAN | OAuth | Macaroons |
|---|---|---|---|
| Offline verification | ✓ | ✗ (introspect endpoint) | ✓ |
| Delegation chains | ✓ | partial (refresh) | ✓ |
| Attenuation (narrowing) | ✓ | ✗ | ✓ |
| Standard wire format | ✓ (JWT-shaped) | ✓ | partial |
| Production implementations | growing | dominant | small ecosystem |
| Decentralized issuance | ✓ (any keypair) | ✗ (needs auth server) | ✓ |

UCAN is the right fit for a substrate that has no central authority.
OAuth requires a server we don't want; macaroons lack ecosystem.

## Open

- Constraint vocabulary — formal schema vs. free-form `nb`?
- Revocation gossip — explicit spec or defer to host transport?
- Inline trust roots vs. external "trusted roots" config — security
  implications differ.
