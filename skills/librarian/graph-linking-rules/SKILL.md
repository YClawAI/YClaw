# Librarian Skill: Graph Linking Rules

> How to create and maintain relationships between vault entries. Load on every
> `vault:write` that involves new or changed references.

## Link Types

Six relationship types are recognized. Use exactly one type per edge:

| Type | Meaning | Directional? | Typical use |
|------|---------|--------------|-------------|
| `depends_on` | A needs B to be true or present | yes (A → B) | Runbook depends on config spec |
| `supersedes` | A replaces B; B is historical | yes (A → B) | New ADR supersedes old one |
| `related_to` | A and B cover adjacent topics | no (bidirectional) | Two runbooks on related subsystems |
| `implements` | A is a concrete implementation of B | yes (A → B) | Code doc implements an architecture spec |
| `documents` | A describes B | yes (A → B) | Runbook documents a service |
| `contradicts` | A and B make opposing claims | no (bidirectional) | Two intel reports with conflicting data — triggers conflict resolution |

Directional links appear as a single forward edge plus an implicit reverse
("A supersedes B" implies "B was superseded by A"). The vault stores both
directions explicitly so queries can traverse either way.

## Mandatory Links

Certain entry types MUST carry certain links. A write that violates these rules
is a schema violation:

- **Every incident post-mortem** (`category:incidents`) must link to:
  - The related deploy entry (if the incident followed a deploy), via `related_to` or `depends_on`.
  - Any runbook that was applied, via `documents` (incident → runbook means the runbook describes the affected system).
  - Any architecture decision that was reconsidered as a result, via `related_to`.

- **Every architecture decision** (`category:architecture`) must link to:
  - The GitHub issue or PR that prompted it, via `documents` (if tracked in the vault) or a `source_url` field (if external).
  - Any prior ADRs it supersedes, via `supersedes`.
  - Components it affects, via `related_to`.

- **Every runbook** (`category:operations`) must link to:
  - The services/components it documents, via `documents`.
  - The architecture decisions that constrain it, via `depends_on`.

Missing mandatory links fail schema validation (see `vault-hygiene-audit/SKILL.md` check 6).

## Bidirectional Storage

Even for directional link types, both directions are stored in the vault so that
`vault:graph_query` can traverse in either direction without a full scan.

On `vault:write`:

1. For each outbound link declared on the new/updated entry:
   - Write the forward edge: `{source entry}.see_also[] += {target, type}`.
   - Write the reverse edge: `{target entry}.see_also[] += {source, type: "reverse_<type>"}`.

2. Bidirectional types (`related_to`, `contradicts`) are stored identically on both ends; no `reverse_` prefix.

Reverse edges are maintained by Librarian alone — other agents writing to the
vault should declare forward edges only. Librarian's `ingest_vault_contribution`
task adds the matching reverse edges.

## Link Validation (On Write)

Every `vault:write` validates that every outbound link target exists:

1. `vault:read` on the target path.
2. If the target exists → write both forward and reverse edges.
3. If the target does NOT exist:
   - Create a **stub** entry at the target path with `status: stub`, `confidence: uncertain`, and a body note: `"Stub created by Librarian because {source path} referenced this path on {iso date}. Fill in or remove."`
   - Flag the stub in the next `librarian:curation_complete` payload.
   - Still write the forward link on the source entry. The stub ensures the link resolves.

Stubs are not kept indefinitely. If a stub is still unfilled after the next
weekly hygiene audit, it's either (a) promoted to a real entry via directive
or (b) deleted along with the inbound link.

## Pruning

During hygiene audit:

1. For every edge where both endpoints are in `vault/99-archive/`, remove the edge. Archived ↔ archived links are dead weight.
2. For every edge where exactly one endpoint is archived, update the live endpoint's link to point to the archive location (preserves the historical reference without breaking the live graph).
3. Edges where the target is marked `status:stub` AND the stub was created more than 30 days ago AND no directive has filled it → remove the edge AND delete the stub. Log both actions.

## Anti-Patterns

- **Do NOT create circular `supersedes` chains.** `supersedes` is a DAG — check for cycles before writing. A cycle is a schema violation.
- **Do NOT use `related_to` as a catch-all.** If `depends_on`, `documents`, or `implements` fits better, use the specific type. Specific types enable useful queries ("what runbooks document this service?").
- **Do NOT manually link archived entries back to live entries.** One direction only: live → archive is fine (historical reference); archive → live creates confusion.
- **Do NOT suppress reverse-edge writes for performance.** The cost of reverse edges is trivial; the cost of a missing reverse edge is an invisible-in-some-direction vault.

## Query Patterns

Common queries Librarian supports via `vault:graph_query`:

- "What depends on service X?" → traverse `related_to` + `depends_on` + `documents` edges where target tag `component:X`.
- "What superseded this ADR?" → follow forward `supersedes` edge.
- "What incidents touched the event bus?" → entries with `category:incidents` + `component:event-bus` tag OR with `see_also` to any entry tagged `component:event-bus`.

Well-linked entries make these queries fast. Sparse linking makes them expensive
and unreliable. Linking discipline is a running investment.
