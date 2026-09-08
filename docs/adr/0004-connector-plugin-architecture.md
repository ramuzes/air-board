# ADR 0004: Connector plugin architecture for external services

## Status

Accepted

## Context

AirBoard integrates with a self-hosted GitLab (push webhooks, commit bindings). More external connectors are plausible later (GitHub, Slack, CI). Two designs were considered: hard-coded GitLab routes in the core HTTP layer, or a small plugin interface where each external service connector registers itself and the core stays connector-agnostic.

## Decision

External-service integration lives in connector plugins:

- A `ConnectorPlugin` interface (id, display name, optional webhook, optional external URL derivation like commit deep-links) implemented per connector.
- A plugin registry mounts each connector's webhook at a predictable path: `/api/plugins/<id>/webhook`.
- The core domain stays generic: it knows "commit bindings" and "repo URLs", not GitLab specifics. The GitLab specifics (X-Gitlab-Token verification, push payload parsing, commit URL derivation from the project's configured repo URL) live inside the gitlab plugin.
- `GET /api/plugins` exposes the registry so agents can discover available connectors and their webhook URLs.
- Redirect/deep-link targets are derived from URLs already configured on the project (e.g. `gitlab_repo_url` + `/-/commit/<sha>`), so linking to the external service requires no separate instance-level configuration.

## Consequences

- Adding a connector is a new module + one registration line; no core route changes.
- Webhook URLs are stable and predictable per connector id.
- The plugin surface is deliberately tiny (webhook + link derivation); it can grow (e.g. outbound actions) without breaking existing plugins, but we do not build those until needed.
- One connector per webhook path; multi-instance connectors (two GitLab instances) would need scoping beyond today's interface — accepted for a single-team deployment.
