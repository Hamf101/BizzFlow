# Strict Provider-Blind E2EE for BizzFlow

> **Status: Deferred — exploratory only; no implementation approved.**
>
> This document preserves a possible future security direction. It does not
> authorize code, configuration, dependency, database, or infrastructure
> changes.

## Summary

BizzFlow is currently encrypted in transit and protected by authentication,
RLS, private R2 storage, and signed URLs—but it is not end-to-end encrypted.
The application server can read document contents, submission values,
signatures, and files; it also renders PDFs from plaintext. Current document
policies generally grant visibility to all active organization members, as
shown in [permissions.ts](../../src/lib/permissions.ts), the
[document RLS migration](../../supabase/migrations/20260708190000_sprint_4_documents.sql),
and
[generated-document-finalization-service.ts](../../src/services/generated-document-finalization-service.ts).

The selected target is strict, provider-blind E2EE:

- Content is encrypted and decrypted only inside signed desktop clients.
- BizzFlow, Supabase, R2, infrastructure operators, and email providers cannot
  decrypt it.
- A customer-controlled recovery custodian can recover organization records.
- The browser application becomes a metadata/control surface and
  install/deep-link page; it never handles decrypted content.
- Routing metadata remains visible. E2EE does not inherently hide identifiers,
  timestamps, sizes, recipients, or access relationships.
  [NIST’s definition likewise distinguishes encrypted content from visible routing information](https://csrc.nist.gov/glossary/term/end_to_end_encryption).

## Architecture and Interface Changes

### Signed endpoint and cryptographic boundary

- Add a Tauri 2 desktop client with all frontend assets bundled locally. Do not
  load remote scripts or execute server-delivered UI code.
- Keep private keys and cryptographic operations in the Rust core, outside the
  WebView. Store device secrets in Tauri Stronghold or an equally reviewed
  native secret store; expose only narrow, typed commands to React. Tauri’s
  model explicitly separates Rust and WebView trust boundaries and supports
  signed application bundles and updates.
  [Tauri security](https://v2.tauri.app/security/),
  [Stronghold](https://v2.tauri.app/plugin/stronghold/),
  [distribution and signing](https://v2.tauri.app/distribute/).
- Require signed/notarized installers, signed updates, an offline/HSM-protected
  release key, two-person release approval, dependency locking, SBOMs, and
  reproducible-build evidence. The E2EE claim excludes a compromised signed
  release pipeline or compromised endpoint.

### Keys and encryption

- Generate separate X25519 encryption and Ed25519 signing key pairs per device.
  Private keys never leave the device unencrypted.
- Generate a fresh random 256-bit data-encryption key for every immutable
  payload or file version.
- Encrypt content using AES-256-GCM with unique 96-bit nonces and 128-bit tags.
  Bind `org_id`, resource ID, version, schema version, payload kind, and chunk
  number as authenticated associated data. AES-GCM is a standardized
  authenticated-encryption mode; key generation, recovery, rotation,
  compromise, and destruction follow NIST key-management guidance.
  [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final),
  [NIST SP 800-57 Part 1](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final).
- Wrap each version key separately to every authorized active device and the
  organization recovery public key using RFC 9180 HPKE. Keep the crypto-suite
  version explicit and non-negotiable by untrusted input.
  [RFC 9180](https://www.rfc-editor.org/info/rfc9180/).
- Place the entire cryptographic implementation behind one small Rust
  interface. Pin its dependencies, run official test vectors, and require
  independent cryptographic review before production; do not create custom
  primitives.
- Do not use Supabase Vault or transparent column encryption for content keys.
  Vault deliberately offers a server-readable decrypted view, while Supabase
  advises against `pgsodium` transparent column encryption because of
  operational and misconfiguration risk.
  [Supabase Vault](https://supabase.com/docs/guides/database/vault),
  [pgsodium guidance](https://supabase.com/docs/guides/database/extensions/pgsodium).

### Authorization and key distribution

- Separate role authority from resource visibility:
  - Roles determine who may create, assign, review, grant, revoke, or
    administer.
  - Explicit resource grants determine who may receive ciphertext and wrapped
    keys.
  - Owner or manager status alone does not imply decryption access.
- Add device certificates, organization key epochs, resource grants, and
  per-device key envelopes. Clients accept device keys only when certified by
  the customer-controlled organization authority; unsigned server-supplied key
  substitutions are rejected.
- Require an existing approved device or recovery custodian to approve new
  devices. Record a signed, monotonic organization key epoch so clients detect
  rollback to old device directories.
- Require Ed25519-signed, replay-protected requests for grants, key rotation,
  recovery, finalization, signatures, and other high-integrity transitions.
- Replace organization-wide document RLS with grant-aware policies. Test active
  membership, resource grant, device ownership, expiry, and revocation.
  Minimize service-role use; it may manage ciphertext and workflow state but
  must never possess private content keys.
- Introduce typed internal contracts for:
  - device enrollment, approval, and revocation;
  - organization recovery-key epochs;
  - resource access grants;
  - encrypted payload versions;
  - per-device HPKE envelopes;
  - signed audit assertions.

### Product workflows

- Encrypt document/template titles, descriptions, template snapshots, answers,
  submission values, comments, signatures, initials, filenames, and file
  bytes.
- Leave only necessary control metadata readable: opaque IDs, tenant, status,
  revision, ciphertext size/hash, timestamps, access grants, device IDs, and
  routing email addresses.
- Encrypt files locally before signed R2 upload. Download ciphertext through
  the existing authorized URL flow and decrypt locally. Large files use a
  versioned authenticated chunk container with deterministic chunk ordering and
  unique nonces.
- Move generated PDF rendering and finalization into the desktop client. Upload
  only the encrypted final PDF plus ciphertext hash. High-integrity
  finalization records contain a client signature over the resource version and
  ciphertext hash.
- Replace server-side plaintext validation with local schema validation plus
  server validation of envelope shape, byte limits, revisions, signatures, and
  state transitions.
- Disable OpenRouter processing for encrypted content. A local model or
  customer-controlled decrypting endpoint may be added later; sending plaintext
  to a third-party AI makes that provider an authorized endpoint.
- Send generic email/SMS notifications without titles, document content,
  signatures, or decryption secrets.
- Replace public browser signing with a desktop deep link. A guest installs the
  signed client, enrolls a temporary device, and the sender approves its
  fingerprint before wrapping the document key. Do not place decryption secrets
  in email links.
- Public forms cannot offer the strict guarantee through the ordinary web
  client. They must use the installable guest client or be explicitly separated
  and labeled as a non-E2EE product mode.
- Server-side malware scanning cannot inspect encrypted files. Perform local
  format validation, avoid inline execution/preview of risky formats, and
  optionally support a customer-controlled scanning endpoint as an explicitly
  authorized decrypting endpoint.

## Rollout

1. Produce a formal threat model and cryptographic protocol specification,
   including metadata leakage, device compromise, key-directory substitution,
   recovery, rollback, and signed-update threats. Obtain independent design
   review before coding production cryptography.
2. Introduce explicit resource grants and grant-aware RLS while data is still
   plaintext. Close same-organization overexposure before adding encryption.
3. Build the signed desktop shell, Rust crypto boundary, device enrollment,
   customer recovery kit, key certificates, and recovery drills.
4. Convert one vertical slice—document upload, grant, download, revoke, and
   recover—to ciphertext-only operation. Validate the architecture before
   converting templates, submissions, comments, signing, and PDF finalization.
5. Migrate each organization during a write freeze: an authorized desktop
   client downloads existing plaintext, encrypts it, verifies local decryption,
   uploads ciphertext, and then removes plaintext rows and R2 originals.
6. Retain no dual plaintext/ciphertext write path after cutover. Do not claim
   historical zero knowledge: BizzFlow previously had access, and plaintext may
   remain in provider backups until their retention windows expire.
7. Enable the provider-blind claim only after an external audit, successful
   recovery exercise, confirmed plaintext deletion, backup-retention expiry,
   and production log/telemetry inspection.

## Test and Acceptance Plan

- Cross-tenant users, ungranted same-tenant users, revoked devices, expired
  grants, and disabled members cannot obtain ciphertext or envelopes.
- Ciphertext copied from Supabase or R2 cannot be decrypted without the
  intended device or customer recovery key.
- Modified ciphertext, nonce, tag, associated data, resource ID, version, or
  chunk order fails closed.
- Unsigned device keys, server-substituted keys, stale key epochs, replayed
  mutations, and resource-history forks are rejected.
- Revocation immediately blocks retrieval and rotates future versions; tests
  document that previously downloaded plaintext or keys cannot be clawed back.
- Customer recovery restores access from the recovery kit without
  BizzFlow-held secrets. Supabase password reset alone does not restore
  encryption keys.
- Database dumps, R2 exports, logs, analytics, crash reports, notifications,
  and temporary files contain no protected plaintext.
- Upload, edit, collaboration, assignment, review, signing, final PDF creation,
  archive download, device replacement, and recovery complete end-to-end
  through signed clients.
- Installers and updates reject invalid signatures; the production client loads
  only bundled code and exposes the minimum Tauri capabilities.
- Run RFC/known-answer vectors, tamper/property tests, RLS negative tests,
  migration rollback tests, and an independent penetration and cryptographic
  assessment.

## Explicit Limits and Defaults

- Metadata remains visible to BizzFlow and its providers.
- The customer recovery custodian can decrypt organization content by explicit
  policy; BizzFlow cannot.
- Authorized users can copy plaintext. Cryptography cannot erase information
  they previously viewed.
- E2EE protects confidentiality, not availability: the server can still delete,
  delay, or deny ciphertext.
- A compromised authorized device can expose everything available to that
  device.
- Browser fallback, server PDF rendering, third-party AI over protected
  content, and ordinary public web forms are intentionally excluded from strict
  E2EE.
- Per-device key wrapping is the pragmatic pilot design. Group protocols such
  as MLS are deferred until measured organization size makes envelope fan-out a
  real problem.
