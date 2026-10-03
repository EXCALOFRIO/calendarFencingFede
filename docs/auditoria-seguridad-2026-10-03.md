# Security audit and local corrections, 2026-10-03

## Scope and status

User-approved scope: **whole repository, `main` including local changes,
standard depth**. The audit covers the working tree, not only published
commits. No repository threat model was found. Runtime airgap mode is false.
During the audit, no review, source code or private artifact was submitted to
an outside service.

Four high-confidence findings were validated and corrected locally.
**The corrections are not deployed.** Production remains on the previous
Neon-backed Worker. A local pass does not approve a production cutover.

The original review used six disjoint source groups:

| Group | Files reviewed |
|---|---:|
| Authentication and app routes/actions | 119 |
| Components | 123 |
| Sporting data and AI extraction | 73 |
| Ingestion | 94 |
| Database and tools | 103 |
| Tests | 210 |

Infrastructure, build/deployment configuration and dependency metadata were
reviewed separately. Another 38 fixture files were screened. Newly added
ownership-request, bounded-download and regression files received follow-up
review; the original group counts are not current release file totals.

The review traced browser input through server actions and DAL writes,
managed-provider sessions into D1 authorization, official downloads into
bounded parsers, private object retrieval, cron reservations and migration
tools. It applied STRIDE, OWASP Top 10, applicable OWASP LLM Top 10 and local
supply-chain checks.

## Validated findings

Locations below identify the **corrected** implementation. They are not a
claim that the same flaw is still present at those lines.

### [P1] [security] Require independent verification before granting athlete ownership

Previously, an invited athlete account could select another person's public
name and claim that record without proving sporting identity. Possession of
a published name or license was not an ownership credential. That grant then
made the victim's athlete record available to account-scoped operations.
CWE-862; OWASP A01/A07; STRIDE spoofing/elevation of privilege.

Correction: `src/lib/altas/por-nombre.ts:500-541` and
`src/lib/altas/solicitudes.ts:20-89` now write only a pending request.
`src/app/(app)/admin/usuarios/actions.ts:340-374` derives the actor from a
writable admin session and requires independent verification plus evidence.
The browser cannot choose the account or source to be approved.

### [P2] [security] Compare and swap ownership with dependent writes in one batch

Previously, ownership was checked in a separate read before an unconditional
update. Two eligible accounts racing to claim the same record could overwrite
the first owner; separate weapon/source writes could leave a partial grant.
CWE-362; OWASP A01/A04; STRIDE tampering/elevation of privilege.

Correction: `src/lib/altas/desde-ranking.ts:485-543`,
`src/lib/altas/por-nombre.ts:648-678` and
`src/lib/altas/vinculo-atomico.ts:11-77` recheck both owner columns,
current account/admin roles, invitation state, request and source evidence
inside one bounded D1 batch. A zero-row CAS aborts the entire batch.
RFEE updates only the approved Skermo ID, not other IDs sharing a license.

### [P2] [security] Neutralize spreadsheet formulas before CSV quoting

Previously, attacker-controlled names or club text could be exported as
spreadsheet formulas. Quoting a CSV cell does not prevent spreadsheet
evaluation when an administrator opens the file.
CWE-1236; OWASP A03; STRIDE tampering.

Correction: `src/lib/csv.ts:6-14` detects formula prefixes after leading
whitespace/control characters and compatibility normalization, prefixes text
with an apostrophe, then applies ordinary CSV quoting. The registration
export applies this to every header and data cell.

### [P2] [security] Bound downloaded and inflated document bytes before retaining output

Previously, a small malicious ZIP document could inflate an XML entry beyond
the Worker memory budget. Downloading the entire HTTP body before checking
its length also trusted a declared or absent size too late.
CWE-400; OWASP A04; OWASP LLM10; STRIDE denial of service.

Correction: `src/lib/ai/documento.ts:75-118` budgets each stored/inflated
XML entry at 4 MiB. `src/lib/ai/extract.ts:3535-3565` budgets streamed
downloads at 40 MiB and cancels on excess. Oversize input becomes terminal
`sin_texto`, without model calls. Interrupted downloads use a namespaced
rejection key, never a fabricated content hash. These are input/output
budgets, not a proof of the Worker's total peak heap.

## Validation evidence

- Latest complete safe offline gate after the capacity/PDF/composition fixes:
  **2,812 passed in 170 files, exit 0, 235.80 seconds**, two workers.
  Explicit exclusions: `datos`, `enlaces`, `seguridad`, `fie-resultados-vivo`,
  `rfee-pdf-vivo`. Responsive/browser cleanup passed. This is not live-provider
  or authenticated production QA.
- Latest semantic compiler: **exit 0**, without incremental state,
  100.24 seconds, covering the new composition and final PDF fixes.
- Latest canonical Cloudflare build: **exit 0, 181.94 seconds**, followed by
  the current Wrangler dry run: **exit 0, 12.28 seconds**. No deployment.
  Nine sensitive values/components matched zero times in 2,228 bundle files
  and three dry-run files; zero `.env` files and all three environment exports
  empty. The first environment-format assertion failed because it expected
  a different export format, not because of a secret match. The corrected
  assertion passed without changing the package.
- Actual national PDF replay after both integrity corrections: **exit 0**,
  1,411 processed, 1,408 with persistence, three malformed, 20,487 reserved
  statements, no incomplete-write flag. Actual accepted totals are 5,256
  competitions, 248,694 results, 668,128 bouts; zero missing fact provenance,
  zero FK violations and `quick_check=ok`. No new persons or identity merges.
- Capacity, exact URL namespace and replay regressions: **103 passed**.
  Historical composition/strict migration/PDF regressions: **71 passed**.
  The 54-table multiple-import integration exceeded its default five-second
  test budget once on Windows (5.9 seconds); only that integration now has an
  explicit twenty-second budget. No runtime limit was raised.
- Read-only independent follow-up reviewed fourteen pipeline/fence/namespace/
  maintenance files and then seven composition/PDF files with dependencies.
  No additional high-confidence security issue was confirmed. Two concrete
  PDF integrity blockers were reproduced natively and corrected: partial/
  conflicted bout sections cannot retire old facts; initial imports checkpoint
  before facts, and reliable retries reconcile after interrupted imports.
  The follow-up found no remaining practical composition blocker. It did not
  inspect private input artifacts or live deployments.

The following earlier checks are retained as history, not the current gate:

- Semantic compiler after the four corrections: **exit 0, 164.18 seconds**.
- Final whole-working-tree semantic compiler: **exit 0, 319.09 seconds**,
  including the latest download diagnostics and restored browser launcher.
- Seven focused security suites: **181 passed**, followed by **101 passed**
  across five suites after the final ownership/checkpoint adjustments.
- Updated ownership suite: **36 passed**, including actual SQLite atomic
  rollback, competing claims, revoked accounts/admins, guardian-column
  ownership, source changes, under-14 denial and schema constraints.
  Two added age assertions initially expected the wrong rejection code;
  correcting them to the existing `CUENTA_NO_ELEGIBLE` response passed.
- A later nine-suite focused run hit the external 240-second command timeout
  after six passing suites. It is not a passed gate. The three remaining
  suites then passed separately: **56 tests, exit 0**.
- Download-window/cache/replacement regressions: **83 passed**, offline.
- First complete post-correction gate: **2,711 assertions passed, exit 1**.
  The only failing suite was responsive QA teardown: Windows `taskkill`
  returned an error. This is not an approved gate. Cleanup now checks actual
  OS process absence rather than assuming Node has observed the exit.
  The corrected responsive/cleanup run passed **54 tests**, exit 0.
- Second complete gate: **2,721 assertions passed, exit 1**. The responsive
  suite again failed in cleanup, waiting for Chromium's `close` event.
  A pipe-free CDP experiment then failed to connect and was reverted.
  That gate remained failed; the latest complete gate above supersedes it.
- Fresh canonical-origin Cloudflare build: **exit 0, 646.03 seconds**,
  including TypeScript validation. `CF_ENV_EMBEBIDO=0`; 69 environment
  entries removed from `next-env.mjs`, whose three exports are empty.
- Wrangler deployment dry run: **exit 0, 39.33 seconds**. No deployment.
- Literal secret-value scan: **nine sensitive values/components checked**,
  zero matches in 2,228 `.open-next` files and three dry-run files; zero
  `.env` files. Only names/counts were reported, never secret values.
- Those earlier build/dry-run/scan results predate the latest import/runtime
  changes and are superseded by the current checks above. No deployment or
  cutover has occurred.

The previous 2,555-test gate and earlier build predate the audit fixes.
They are historical evidence, not approval of this release. Production OTP,
role behavior, real D1 batch semantics and owner-assisted responsive QA are
also pending.

## Supply chain

Local inspection covered 941 lockfile entries, configured resolution origins,
integrity metadata, direct installed versions and nine install-script package
entries. Installation scripts were not run for the audit. Registry enrichment
timed out after 60 seconds: **SKIPPED_TIMEOUT**. Package age, popularity and
maintainer freshness remain unverified. Missing enrichment does not establish
that a dependency is safe or unsafe.

## Release requirements and retained limits

Apply D1 migrations in this order: **0000 → import and strict verification →
0001 → 0002 → 0003 → new runtime**. `0003` is not part of the exact
54-table export foundation. Do not apply PostgreSQL 0021 to Neon.

Preserve managed Neon Auth IDs and provider configuration. Freeze the old
application's production writers before taking the final export. Do not
delete Neon, enable technical QA grants or merge identities by name.
Existing ownership records are retained; the old `linked_via='persona'`
audit label is not proof of the new independent review.

The authorized downloads and offline fact imports are separate phases.
The finite second FIE pass exhausted its inventory: 3,137 closed, eleven
partial, six source errors. R2 verified 9,614 FIE blobs with three bounded
partitions and a final index; the national archive verified 2,109 blobs and
its manifest. A fresh read-only R2 check verified index/partition/original
manifest hashes, exit 0. No source approval was reset or reopened.
FIE and both national readers have been replayed into private local staging,
not remote D1. The transfer preserves the fresh application/AuthID snapshot
and permits only five source-owned fact tables to differ; fresh fact or
identity drift aborts instead of blindly merging UUIDs. Every output still
passes the unchanged exact-schema importer.
The selected replay cap remains ten units/64 MiB; each R2 partition remains
at most 3,500 blobs/4 MiB. Partial sources, deferred identities, OCR review,
three invalid national responses and 6,063 older pending FIE coverage rows
remain. No historical-completeness claim is made.
No independent verification of every sporting identity, full
historical coverage, security certification or unconditional all-clear is
claimed.
