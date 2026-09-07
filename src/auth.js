import { DEFAULT_ADMIN_EMAIL, DEFAULT_ORG_EMAIL_DOMAIN } from "./constants.js";
import { MULTIPLIERS_LOGO_DATA_URI } from "./logo.js";
import { clean, escapeAttr, escapeHtml, html, norm } from "./util.js";

const TEST_COOKIE = "multipliers_test_auth";
const TEST_COOKIE_MAX_AGE = 8 * 60 * 60;
const LOCAL_TEST_AUTH_KEY = "local-preview";

export async function readUser(request, env, ctx) {
  const accessIdentity = await readCloudflareAccessIdentity(ctx);
  const testProfile = await readTestProfile(request, env);
  let email = "";
  let id = "";
  let name = "";

  if (testProfile) {
    if (testProfile === "admin") {
      email = firstAdminEmail(env);
      name = env.DEV_USER_NAME || "Admin User";
    } else {
      email = clean(env.TEST_APPLICANT_EMAIL) || "test.applicant@example.com";
      name = env.TEST_APPLICANT_NAME || "Applicant Tester";
    }
    id = `test-${testProfile}`;
  } else {
    email = clean(accessIdentity?.email) || request.headers.get("oai-authenticated-user-email") || "";
    id = clean(accessIdentity?.user_uuid || accessIdentity?.sub || accessIdentity?.id) || request.headers.get("oai-authenticated-user-id") || "";
    if (accessIdentity?.name) {
      name = clean(accessIdentity.name);
    }
    const rawName = request.headers.get("oai-authenticated-user-full-name") || "";
    const nameEncoding = request.headers.get("oai-authenticated-user-full-name-encoding") || "";
    if (!name && rawName && nameEncoding === "percent-encoded-utf-8") {
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = "";
      }
    }
  }

  const emailNorm = norm(email);
  const admins = adminEmails(env);
  const orgDomain = norm(env.ORG_EMAIL_DOMAIN || DEFAULT_ORG_EMAIL_DOMAIN).replace(/^@/, "");

  return {
    id,
    email,
    emailNorm,
    name: name || email.split("@")[0] || "Multiplier",
    isMosaic: Boolean(testProfile) || (orgDomain ? emailNorm.endsWith(`@${orgDomain}`) : false),
    isAdmin: testProfile === "admin" || admins.includes(emailNorm),
    isTestUser: Boolean(testProfile),
    canUseTestProfiles: testAuthEnabled(env) && Boolean(effectiveTestAuthKey(env, request)),
  };
}

export async function testAuthRoute(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/test-logout" && request.method === "POST") {
    return redirectWithCookie("/", clearTestCookie(request));
  }
  if (url.pathname === "/test-profile" && request.method === "POST") {
    if (!testAuthEnabled(env) || !effectiveTestAuthKey(env, request)) {
      return html("Temporary test access is not enabled.", { status: 404 });
    }
    const currentProfile = await readTestProfile(request, env);
    if (!currentProfile) {
      return new Response(null, { status: 303, headers: { location: "/test-login" } });
    }
    const form = await request.formData();
    const profile = safeProfile(form.get("profile"));
    const next = profile === "applicant" ? "/" : "/admin";
    return redirectWithCookie(next, await makeTestCookie(profile, env, request));
  }
  if (url.pathname !== "/test-login") {
    return null;
  }
  if (!testAuthEnabled(env)) {
    return html(testLoginPage({ error: "Temporary test access is not enabled.", next: "/", localBypass: isLocalRequest(request) }), { status: 404 });
  }
  const key = effectiveTestAuthKey(env, request);
  const localBypass = isLocalRequest(request);
  if (!key) {
    return html(testLoginPage({ error: "Temporary test access is enabled but no test key is configured.", next: "/", localBypass }), { status: 503 });
  }
  if (request.method === "GET") {
    const requestedNext = url.searchParams.get("next");
    const profile = url.searchParams.has("profile") ? safeProfile(url.searchParams.get("profile")) : defaultProfileForNext(requestedNext);
    return html(testLoginPage({ next: safeNext(requestedNext, profile === "applicant" ? "/" : "/admin"), profile, localBypass }));
  }
  if (request.method !== "POST") {
    return html("Method not allowed", { status: 405 });
  }

  const form = await request.formData();
  const password = clean(form.get("password"));
  const profile = safeProfile(form.get("profile"));
  let next = safeNext(form.get("next"), profile === "applicant" ? "/" : "/admin");
  if (profile === "applicant" && next.startsWith("/admin")) {
    next = "/";
  }
  if (!localBypass && password !== key) {
    return html(testLoginPage({ error: "That test code did not match.", next, profile, localBypass }), { status: 401 });
  }
  return redirectWithCookie(next, await makeTestCookie(profile, env, request));
}

export function requireMosaic(user, cycle, request, env) {
  if (user.isMosaic || user.isAdmin) {
    return null;
  }
  if (cycle?.allow_public_test_mode) {
    return null;
  }
  if (testAuthEnabled(env)) {
    const next = encodeURIComponent(new URL(request.url).pathname);
    return new Response(null, { status: 303, headers: { location: `/test-login?next=${next}` } });
  }
  return html(loginNeededPage("Company login needed", "Use your company Google account."), { status: 401 });
}

export function requireAdmin(user, request, env) {
  if (user.isAdmin) {
    return null;
  }
  if (testAuthEnabled(env)) {
    const next = encodeURIComponent(new URL(request.url).pathname);
    return new Response(null, { status: 303, headers: { location: `/test-login?next=${next}` } });
  }
  return html(loginNeededPage("Admin access needed", "Use an admin account."), { status: 403 });
}

function testAuthEnabled(env) {
  return env.ALLOW_TEST_AUTH === "true";
}

function testAuthKey(env) {
  return clean(env.TEST_AUTH_KEY);
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL)
    .split(",")
    .map(norm)
    .filter(Boolean);
}

function firstAdminEmail(env) {
  return adminEmails(env)[0] || DEFAULT_ADMIN_EMAIL;
}

async function readCloudflareAccessIdentity(ctx) {
  if (!ctx?.access) {
    return null;
  }
  try {
    return await ctx.access.getIdentity();
  } catch {
    return null;
  }
}

async function readTestProfile(request, env) {
  if (!testAuthEnabled(env) || !effectiveTestAuthKey(env, request)) {
    return "";
  }
  const value = cookieValue(request.headers.get("cookie") || "", TEST_COOKIE);
  if (!value) {
    return "";
  }
  const [profile, signature] = value.split(".", 2);
  if (!["admin", "applicant"].includes(profile)) {
    return "";
  }
  const expected = await signProfile(profile, env, request);
  return signature === expected ? profile : "";
}

async function makeTestCookie(profile, env, request) {
  const value = `${profile}.${await signProfile(profile, env, request)}`;
  return `${TEST_COOKIE}=${value}; Path=/; HttpOnly${secureCookiePart(request)}; SameSite=Lax; Max-Age=${TEST_COOKIE_MAX_AGE}`;
}

function clearTestCookie(request) {
  return `${TEST_COOKIE}=; Path=/; HttpOnly${secureCookiePart(request)}; SameSite=Lax; Max-Age=0`;
}

function secureCookiePart(request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

async function signProfile(profile, env, request) {
  const bytes = new TextEncoder().encode(`${profile}:${effectiveTestAuthKey(env, request)}:multipliers-os`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(header, name) {
  const parts = header.split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  const found = parts.find((part) => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function safeProfile(value) {
  return clean(value) === "applicant" ? "applicant" : "admin";
}

function defaultProfileForNext(value) {
  return clean(value).startsWith("/admin") ? "admin" : "applicant";
}

function safeNext(value, fallback = "/admin") {
  const next = clean(value);
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function effectiveTestAuthKey(env, request) {
  return testAuthKey(env) || (isLocalRequest(request) ? LOCAL_TEST_AUTH_KEY : "");
}

function isLocalRequest(request) {
  const host = new URL(request.url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function redirectWithCookie(location, cookie) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "set-cookie": cookie,
    },
  });
}

function testLoginPage({ error = "", next = "/admin", profile = "admin", localBypass = false }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test access - Multipliers OS</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#17202a;background:#f5f7fa}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FAFAF9;padding:24px}
    main{width:min(460px,100%);background:#fff;border:1px solid #d8e0e7;border-radius:8px;box-shadow:0 18px 48px rgba(18,32,50,.10);padding:24px}
    .logo{display:block;width:min(270px,100%);margin-bottom:22px}
    .logo img{display:block;width:100%;height:auto}
    h1{font-size:28px;line-height:1.1;margin:0 0 8px;letter-spacing:0}
    p{margin:0 0 18px;color:#64717e;line-height:1.45}
    label{display:block;margin:0 0 13px;font-weight:760}
    label span{display:block;margin-bottom:6px}
    input,select,button{width:100%;min-height:42px;border-radius:7px;font:inherit}
    input,select{border:1px solid #b8c5d1;padding:10px 11px;background:#fff;color:#17202a}
    input:focus,select:focus{outline:0;border-color:#0F5745;box-shadow:0 0 0 3px rgba(15,87,69,.14)}
    button{border:0;background:#0F5745;color:#fff;font-weight:850;cursor:pointer}
    .error{border:1px solid #e9a79e;background:#ffe7e3;color:#843128;border-radius:8px;padding:11px 12px;margin-bottom:14px;font-weight:760}
  </style>
</head>
<body>
  <main>
    <span class="logo"><img src="${MULTIPLIERS_LOGO_DATA_URI}" alt="Multipliers"></span>
    <h1>Temporary test access</h1>
    <p>${localBypass ? "Local preview is open. Pick a side and enter." : "Use the temporary code to preview Multipliers OS without company login during this test phase."}</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="post" action="/test-login">
      <input type="hidden" name="next" value="${escapeAttr(next)}">
      <label><span>Open as</span><select name="profile">
        <option value="admin" ${profile === "admin" ? "selected" : ""}>Admin cockpit</option>
        <option value="applicant" ${profile === "applicant" ? "selected" : ""}>User / applicant view</option>
      </select></label>
      ${localBypass ? "" : `<label><span>Test code</span><input name="password" type="password" autocomplete="current-password" autofocus required></label>`}
      <button>Enter Multipliers OS</button>
    </form>
  </main>
</body>
</html>`;
}

function loginNeededPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main style="font-family:system-ui;padding:32px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}
