# Multipliers OS

Phase 1 backend-first build.

This is a Cloudflare Worker app for OpenAI Sites with D1 as source of truth. It handles:

- Mosaic-login applicant form with prefilled locked name/email from auth headers.
- Versioned submissions by applicant email, latest-only admin views, full audit/history.
- Admin cycle controls, cohort edit access, route settings, undo/restore by version.
- Objective blocker flags and material-edit manager recheck rules.
- Manager grouped approval emails, Team 1 manager skip, natural Gmail reply sync.
- Function-head grouped approval emails once all relevant rows are ready.
- Rework tasks, admin task digest, final dataset snapshot, participant confirmations.
- XLSX export fallback for latest submissions/final participants.

## Runtime bindings

- D1 binding: `DB`
- Gmail env vars:
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`
  - `GMAIL_SENDER=multipliers@mosaicwellness.in`
  - `ADMIN_EMAILS=simar.kaler@mosaicwellness.in`

## Build

Run:

```powershell
.\scripts\build.ps1
```

Output:

- Worker entry: `dist/server/index.js`
- Static assets/styles are rendered by the Worker.

## Notes

- Live access is server-side restricted to `@mosaicwellness.in`; admin is allowlisted.
- Public test mode is available only when admin enables it for a cycle or env permits dev auth.
- Sub department is optional. All other applicant fields are required by default.
- The Worker includes a `scheduled` handler for Gmail sync, reminders/escalations, and the 8:00 AM admin digest; hosting must attach an appropriate cron/trigger.
- Publishing through Sites needs local `git`, `node`, and `bash` so the source can be pushed and packaged with the Sites helper.
