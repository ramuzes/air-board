# ADR 0003: Append-only revision history for Resource content

## Status

Accepted

## Context

Resource content is edited by both humans and Agents, sometimes concurrently. The alternatives were storing only the latest content (history via git only) versus full version history in AirBoard itself.

## Decision

Every content save (via API or UI) appends an immutable, sequentially numbered Revision. Revisions are never mutated or deleted; the latest revision defines current content. The API exposes listing and fetching of any revision.

## Consequences

- Agents can diff prior work and roll back by re-posting an old revision's content.
- Storage grows with edit count — acceptable at team scale; pruning can be added later if ever needed.
- Revert is "copy old content forward", keeping history linear and honest.
