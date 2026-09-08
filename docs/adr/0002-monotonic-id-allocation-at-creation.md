# ADR 0002: Monotonic per-kind IDs allocated at creation, never reused

## Status

Accepted

## Context

Multiple developers and Agents create Resources concurrently and each needs a unique human-referenceable ID (`ADR-42`). Two designs were considered: a reserve-then-write flow (an endpoint hands out IDs held for a window, docs claim them later), and allocation at creation (POST creates the Resource immediately in `draft` and the transaction assigns the next number).

## Decision

Allocate the Resource ID inside the creation transaction. Creation always succeeds fast and returns the complete Resource in `draft` state; the requester then edits content in follow-up updates. A cancelled draft leaves a permanent gap in the number sequence; numbers are never reused or recycled.

## Consequences

- No reservation state machine, no expiry job, no two-step client protocol — the simplest thing that works for concurrent agents.
- The single SQLite writer guarantees no duplicate allocation.
- Gaps in numbering are accepted as the cost of cancellation; history stays truthful (a gap always means "there was a cancelled thing").
