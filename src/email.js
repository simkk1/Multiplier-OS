import { DEFAULT_SENDER_EMAIL } from "./constants.js";
import { clean, norm } from "./util.js";

export function gmailConfigured(env) {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export function gmailStatus(env, request = null) {
  const missing = [
    ["GMAIL_CLIENT_ID", env.GMAIL_CLIENT_ID],
    ["GMAIL_CLIENT_SECRET", env.GMAIL_CLIENT_SECRET],
    ["GMAIL_REFRESH_TOKEN", env.GMAIL_REFRESH_TOKEN],
  ].filter(([, value]) => !value).map(([name]) => name);
  return {
    configured: missing.length === 0,
    missing,
    sender: env.GMAIL_SENDER || DEFAULT_SENDER_EMAIL,
    localPreview: isLocalPreview(request),
  };
}

function isLocalPreview(request) {
  try {
    const host = new URL(request?.url || "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export function gmailErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (message.includes("Gmail env missing") || message.includes("Gmail is not configured")) {
    return "Gmail is not connected yet. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN before sending, drafting, or syncing email.";
  }
  if (message.includes("invalid_client") || /Gmail auth failed:\s*401/i.test(message)) {
    return "Gmail rejected the OAuth client. The client ID, client secret, and refresh token must come from the same Google OAuth app.";
  }
  if (message.includes("invalid_grant")) {
    return "Gmail refresh token is invalid, revoked, expired, or was issued for a different OAuth client. Reconnect Gmail and save a new refresh token.";
  }
  if (/Gmail .* failed:/i.test(message)) {
    return message.slice(0, 700);
  }
  return `Gmail action failed: ${message.slice(0, 700)}`;
}

export async function sendGmail(env, { to, cc = "", subject, body, threadId = "" }) {
  const token = await gmailAccessToken(env);
  const raw = buildRawEmail({
    from: env.GMAIL_SENDER || DEFAULT_SENDER_EMAIL,
    to,
    cc,
    subject,
    body,
  });
  const payload = threadId ? { raw, threadId } : { raw };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function createGmailDraft(env, { to, cc = "", subject, body, threadId = "" }) {
  const token = await gmailAccessToken(env);
  const raw = buildRawEmail({
    from: env.GMAIL_SENDER || DEFAULT_SENDER_EMAIL,
    to,
    cc,
    subject,
    body,
  });
  const message = threadId ? { raw, threadId } : { raw };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getThread(env, threadId) {
  const token = await gmailAccessToken(env);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail thread read failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function gmailAccessToken(env) {
  const status = gmailStatus(env);
  if (!status.configured) {
    throw new Error(`Gmail is not configured. Missing: ${status.missing.join(", ")}`);
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail auth failed: ${res.status} ${await safeResponseText(res)}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function safeResponseText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function buildRawEmail({ from, to, cc, subject, body }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    `Subject: ${encodeMimeWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ].filter(Boolean);
  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return base64Url(new TextEncoder().encode(message));
}

function encodeMimeWord(value) {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

function base64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64Url(bytes) {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function extractMessage(message) {
  const headers = Object.fromEntries((message.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  const body = extractBody(message.payload);
  return {
    id: message.id,
    threadId: message.threadId,
    from: headers.from || "",
    to: headers.to || "",
    subject: headers.subject || "",
    date: headers.date || "",
    body,
    hasAttachments: hasAttachments(message.payload),
  };
}

function extractBody(part) {
  if (!part) {
    return "";
  }
  const mime = part.mimeType || part.mime_type || "";
  if (part.body?.data && (mime.includes("text/plain") || !part.parts)) {
    return decodeBase64Url(part.body.data);
  }
  const parts = part.parts || [];
  const plain = parts.find((p) => (p.mimeType || p.mime_type || "").includes("text/plain"));
  if (plain) {
    return extractBody(plain);
  }
  return parts.map(extractBody).filter(Boolean).join("\n");
}

function hasAttachments(part) {
  if (!part) {
    return false;
  }
  if (part.filename || part.body?.attachmentId) {
    return true;
  }
  return (part.parts || []).some(hasAttachments);
}

function decodeBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function classifyReply(text, itemNames = [], hasAttachments = false) {
  const body = norm(text);
  if (hasAttachments) {
    return { type: "admin_review", reason: "Attachment in reply" };
  }
  if (!body) {
    return { type: "admin_review", reason: "Blank reply" };
  }
  const approval = /\b(ok|okay|gtg|good to go|approved|looks good|fine by me|works|all good|go ahead)\b/.test(body);
  const rework = /\b(change|changes|rework|revise|sharpen|edit|update|not aligned|not ok|not okay)\b/.test(body);
  const reject = /\b(reject|rejected|cannot approve|not approve|drop this|not suitable)\b/.test(body);
  const discuss = /\b(discuss|talk to|speak to|connect with|align with|will close|fine tune|fine-tune)\b/.test(body);
  if ((approval && (rework || reject || discuss)) || (rework && reject)) {
    return { type: "admin_review", reason: "Mixed language in reply" };
  }
  if (discuss) {
    return { type: "discuss", reason: "Manager said they will discuss/align" };
  }
  if (reject) {
    return { type: "rejected", reason: clean(text).slice(0, 600) };
  }
  if (rework) {
    return { type: "rework", reason: clean(text).slice(0, 800) };
  }
  if (approval) {
    if (itemNames.length <= 1 || /\b(all|everyone|both|each)\b/.test(body)) {
      return { type: "approval", reason: "Clear approval" };
    }
    const named = itemNames.filter((name) => body.includes(norm(name).split(/\s+/)[0]));
    if (named.length === itemNames.length) {
      return { type: "approval", reason: "All named applicants approved" };
    }
    return { type: "admin_review", reason: "Approval unclear for multi-applicant thread" };
  }
  return { type: "admin_review", reason: "Unclear reply" };
}
