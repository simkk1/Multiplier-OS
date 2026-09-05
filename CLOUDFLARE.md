# Cloudflare Deployment

This is the production path for Multipliers OS.

## Flow

1. Push code to the GitHub `main` branch.
2. GitHub Actions builds the Worker from `src` into `dist/server`.
3. The workflow applies D1 migrations from `drizzle`.
4. The workflow deploys `multipliers-os` to Cloudflare Workers.
5. Cloudflare Cron calls the scheduled Worker handler every 15 minutes for Gmail sync, reminders, escalations, and the 8:00 AM admin digest.

## Cloudflare Setup

Create one D1 database:

```bash
npx wrangler d1 create multipliers-os-db
```

Save the returned database id as the GitHub secret `CLOUDFLARE_D1_DATABASE_ID`.

Protect the Worker with Cloudflare Access and allow your company email domain. The app reads the signed-in user's email from `ctx.access`, so applicant name/email stay locked to login identity.

## GitHub Secrets

Add these repository secrets before the first deploy:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
ADMIN_EMAILS
ORG_EMAIL_DOMAIN
GMAIL_SENDER
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
FUNCTION_ROUTES_JSON
TEAM1_MANAGERS_JSON
```

The Gmail secrets must belong to the sender mailbox you configure with `GMAIL_SENDER`.

`FUNCTION_ROUTES_JSON` and `TEAM1_MANAGERS_JSON` can be `[]` for the first deploy. Admin can also add routes and Team 1 managers in the app after login.

## Local Commands

```bash
npm run build
npm run check
npm run dev
```

For local authenticated testing, use Cloudflare Access dev config or temporarily set `ALLOW_DEV_AUTH=true` in a local `.dev.vars` file. Do not use dev auth in production.

## Custom Domain

After the first Worker deploy, attach a Cloudflare route or custom domain such as:

```text
multipliers.yourcompany.com
```

Then put that hostname behind Cloudflare Access.
