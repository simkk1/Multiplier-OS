# Gmail OAuth Setup

Multipliers OS uses the Gmail API for three actions:

| App action | Gmail API method | Minimum scope |
| --- | --- | --- |
| Send live manager/function emails | `users.messages.send` | `https://www.googleapis.com/auth/gmail.send` |
| Create draft emails | `users.drafts.create` | `https://www.googleapis.com/auth/gmail.compose` |
| Read approval replies in sent threads | `users.threads.get` | `https://www.googleapis.com/auth/gmail.readonly` |

Configure these GitHub secrets before using email features:

```text
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
GMAIL_SENDER
```

`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` must belong to the same Google OAuth app. If they do not match, Google can return `401 invalid_client`. If the refresh token is revoked, expired, issued for a different client, or invalidated by account policy, Google can return `invalid_grant`.

Until the three OAuth secrets are present, Multipliers OS keeps sending, drafting, and Gmail sync paused and shows the missing secret names in the admin cockpit.

Reference docs:

- Gmail send: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- Gmail drafts: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- Gmail threads: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get
- OAuth offline access: https://developers.google.com/identity/protocols/oauth2/web-server
