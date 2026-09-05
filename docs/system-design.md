# Multipliers OS Phase 1 System Design

## Purpose

Multipliers OS Phase 1 runs the quarterly application and approval cycle from applicant submission through manager review, function-head review, final dataset closure, audit history, and XLSX fallback export.

The system is intentionally backend-first and server-rendered so the approval workflow, database state, and email trail stay in one dependable path while the frontend remains fast and simple.

## Requirements

| Area | Requirement |
| --- | --- |
| Applicant form | Prefill name and email from login identity, lock those fields, and require all core application fields except sub department. |
| Versions | Keep every submission version during the active cycle. Admin views and emails use only the latest submission per applicant email. |
| Quarter rollover | After a finalized quarter is closed, retain only the final/latest submission version while keeping cycle memory for future automation tuning. |
| Manager approvals | Send one grouped request per manager. Team 1 manager-skipped rows bypass duplicate manager approval. Natural email replies and review-page actions both feed the same request state. |
| Rework | Keep one active rework task per applicant per cycle, with all requested changes inside that task. Applicants edit the form rather than replying with direct edits. |
| Function approvals | Send only when every relevant applicant is manager approved, manager rejected with reason, or Team 1 manager-skipped. Function-head emails are grouped by function/subfunction. |
| Admin controls | Admin can edit submissions, restore versions, manage routes, open or close cohort edit access, export XLSX, save snapshots, and finalize the dataset. |
| Email safety | Initial rework/approval mail can be drafted before fully automatic send mode. Conflicting or unclear replies create admin review tasks. |
| Testing access | During the test phase, company login can be bypassed only through a temporary password gate, not anonymous public admin access. |

## Modules

| Module | Interface | Responsibility |
| --- | --- | --- |
| `src/index.js` | Worker `fetch` and `scheduled` handlers | Request routing, page/API orchestration, scheduled Gmail sync, reminders, escalations, and daily digest. |
| `src/auth.js` | `readUser`, `requireMosaic`, `requireAdmin`, `testAuthRoute` | Cloudflare Access identity, temporary test login, admin checks, and protected-route redirects. |
| `src/db.js` | Cycle, submission, version, task, route, snapshot, and finalization functions | D1 persistence and workflow state transitions. |
| `src/approvals.js` | Prepare, send/draft, sync, reminder, and review functions | Manager/function request lifecycle and Gmail reply classification. |
| `src/email.js` | Gmail send/draft/search/read helpers | Gmail REST adapter behind a small email interface. |
| `src/views.js` | Page render functions | Server-rendered applicant, admin, reviewer, audit, task, and route UI. |
| `src/xlsx.js` | `makeXlsx` | XLSX export generation without adding a heavy runtime dependency. |

The auth module is the newest seam. It keeps temporary test behavior behind the same caller interface as real Cloudflare Access, so returning to company login later should be a config change rather than a route rewrite.

## Data Flow

1. Applicant opens the app through company login or temporary test access.
2. The Worker reads identity and loads the active cycle from D1.
3. Applicant submits the form. D1 stores or updates the latest submission and appends a version record.
4. Admin prepares grouped manager approval requests from the latest eligible submissions.
5. Manager replies by email or uses the review page. Clear approvals are auto-marked; unclear, conflicting, or mixed responses create admin review tasks.
6. Function-head requests are prepared only after the manager stage is closed for all relevant applicants in that function group.
7. Admin finalizes the dataset after function closure. D1 records final participants and a final snapshot.
8. Admin can export XLSX at any point as an operational fallback.

## Frontend Shape

| Surface | Design intent |
| --- | --- |
| Applicant home | Friendly, low-friction entry with a clear approval journey and current-cycle summary without showing names. |
| Applicant form | Structured as a form, not a spreadsheet: locked identity, manager/team, target details, and manager-alignment confirmation. |
| Applicant status | Shows the same approval journey language as the home page, plus latest details, rework tasks, and version history. |
| Admin cockpit | Dense but calm operating screen: cycle state, workflow progress, KPIs, settings, tasks, approval threads, snapshots, and quarter controls. |
| Admin database | Filterable latest-only submission table with flags, manager/function/final status, and detail links. |
| Reviewer page | Simple grouped approval surface for managers and function heads, with latest version warning if a submission changed after the email. |

## Operational Controls

| Control | Owner | Notes |
| --- | --- | --- |
| `ADMIN_EMAILS` | GitHub/Cloudflare secret | Comma-separated admin allowlist. |
| `ORG_EMAIL_DOMAIN` | GitHub/Cloudflare secret | Company email domain for real login. |
| `ALLOW_TEST_AUTH` | Worker var | Enables the temporary test login route. |
| `TEST_AUTH_KEY` | GitHub/Cloudflare secret | Required for password-gated test access. |
| `FUNCTION_ROUTES_JSON` | GitHub/Cloudflare secret, then admin UI | Optional seed data for function-head routing. |
| `TEAM1_MANAGERS_JSON` | GitHub/Cloudflare secret, then admin UI | Optional seed data for Team 1 manager skip rules. |
| Gmail OAuth secrets | GitHub/Cloudflare secrets | Required before real email sending/drafting is enabled. |

## Tradeoffs

| Choice | Benefit | Cost |
| --- | --- | --- |
| Server-rendered Worker UI | Simple deploy, no separate frontend hosting, fewer moving parts. | Rich client interactions require deliberate incremental enhancement. |
| D1 as source of truth | Fits Cloudflare deployment and quarterly workflow scale. | Complex ad hoc analytics may eventually need export or warehouse sync. |
| Temporary password gate | Lets the test phase proceed without company login. | Must be removed or disabled before production Access goes live. |
| Latest-only admin views with version history | Keeps operations clean while preserving auditability. | Admins need explicit version restore tools for historical corrections. |
| Draft-first email modes | Safer while the model learns manager reply patterns. | Requires admin review before full automation confidence. |

## Production Readiness

Before real launch:

1. Disable `ALLOW_TEST_AUTH` or leave it enabled only with a rotated short-lived key.
2. Protect the Worker with Cloudflare Access for the company email domain.
3. Configure Gmail OAuth secrets for the sender mailbox.
4. Add production function routes and Team 1 manager rules through admin UI or runtime seed secrets.
5. Send one test manager approval email and one test function approval email.
6. Verify XLSX export, version restore, manager recheck, and admin digest behavior on a sample submission.
