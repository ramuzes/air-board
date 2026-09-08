# AirBoard — Glossary

The ubiquitous language of AirBoard. Implementation-free; decisions live in `docs/adr/`, designs in `docs/specs/`.

## Terms

**AirBoard** — The project management service itself: a self-hosted, single-team system for tracking the documents and issues of software development, designed so that both humans and AI Agents work through the same HTTP API.

**Project** — The unit of organization inside AirBoard. Every Resource belongs to exactly one Project. A Project has a stable short key (used in URLs and by GitLab bindings).

**User** — An identifiable human member of the team. Users authenticate with a personal Access Token. Ownership and authorship of Resources are attributed to Users.

**Agent** — A non-human client (an AI coding assistant or automation) acting on behalf of a User. Agents are not separate principals: they use their sponsoring User's Access Token, and API calls may record which Agent made them.

**Access Token** — A secret bearer credential owned by a User. Grants full access as that User. Revocable, created via UI or API.

**Resource** — Any tracked item in a Project. AirBoard launches with five Resource kinds: ADR, PRD, SPEC, PLAN, ISSUE.

**Resource Kind** — Which of the five types a Resource is: ADR (architecture decision record), PRD (product requirements document), SPEC (technical design specification), PLAN (implementation plan), ISSUE (piece of work or problem). Kind is immutable once assigned.

**Resource ID** — The stable public identifier of a Resource, of the form `KIND-number` (e.g. `ADR-42`, `ISSUE-345`). Numbers are monotonic per (Project, Kind); allocated by AirBoard at creation; gaps exist and numbers are never reused.

**Lifecycle** — The shared state machine every Resource follows: `draft` → `active` → `done`, with `cancelled` reachable from `draft` or `active`. A cancelled Resource is retained for history, never deleted.

**Revision** — An immutable snapshot of a Resource's content. Every content save appends a new Revision; the previous ones remain readable. Revisions are numbered sequentially starting at 1.

**Content** — The markdown body of a Resource, plus its title. Everything an author writes; versioned as Revisions.

**Commit Binding** — The recorded association between a git commit (identified by repository and SHA) and the Resource whose ID is referenced in the commit message. One commit may bind to several Resources; one Resource accumulates many bindings over its life.

**Agent Instructions** — The machine-fetchable, self-describing setup document AirBoard serves to Agents: base URL, auth scheme, ID conventions, endpoint catalogue (OpenAPI), and usage etiquette.
