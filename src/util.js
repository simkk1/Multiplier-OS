import { MATERIAL_FIELDS, OBJECTIVE_FLAG_COPY, REQUIRED_FIELDS } from "./constants.js";

export function nowIso() {
  return new Date().toISOString();
}

export function norm(value) {
  return String(value || "").trim().toLowerCase();
}

export function clean(value) {
  return String(value || "").trim();
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

export function redirect(location) {
  return new Response(null, { status: 303, headers: { location } });
}

export async function formData(request) {
  const form = await request.formData();
  const out = {};
  for (const [key, value] of form.entries()) {
    const next = clean(value);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = [out[key], next].filter(Boolean).join("; ");
    } else {
      out[key] = next;
    }
  }
  return out;
}

export function parseBool(value) {
  const v = norm(value);
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function safeJsonParse(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function summarizeChange(before, after) {
  if (!before) {
    return "Initial submission";
  }
  const changed = Object.keys(after).filter((key) => String(before[key] ?? "") !== String(after[key] ?? ""));
  return changed.length ? changed.join(", ") : "No field changes";
}

export function isMaterialChange(before, after) {
  if (!before) {
    return false;
  }
  return MATERIAL_FIELDS.some((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
}

export function analyzeFlags(data, cycle) {
  const flags = [];
  const required = REQUIRED_FIELDS.filter((field) => field !== "sub_department");
  for (const field of required) {
    if (field === "aop" && !cycle.aop_required) {
      continue;
    }
    if (field === "manager_aligned") {
      if (!parseBool(data[field])) {
        flags.push("manager_not_aligned");
      }
      continue;
    }
    if (!clean(data[field])) {
      flags.push("blank_required");
      break;
    }
  }
  if (!clean(data.baseline)) {
    flags.push("no_baseline");
  }
  if (!/\d|fy|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(data.multiplier_target || "")) {
    flags.push("no_numeric_or_dated_target");
  }
  if (sameMeaning(data.regular_okr, data.multiplier_target)) {
    flags.push("multiplier_same_as_regular_okr");
  }
  if (!isEmail(data.manager_email)) {
    flags.push("invalid_manager_email");
  }
  if (!clean(data.department)) {
    flags.push("department_missing");
  }
  return [...new Set(flags)];
}

export function sameMeaning(a, b) {
  const left = norm(a).replace(/\s+/g, " ");
  const right = norm(b).replace(/\s+/g, " ");
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const la = tokenSet(left);
  const rb = tokenSet(right);
  if (!la.size || !rb.size) {
    return false;
  }
  let overlap = 0;
  for (const token of la) {
    if (rb.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(la.size, rb.size) > 0.88;
}

function tokenSet(value) {
  return new Set(value.split(/[^a-z0-9]+/i).filter((token) => token.length > 2));
}

export function flagLabels(flags) {
  return (flags || []).map((flag) => OBJECTIVE_FLAG_COPY[flag] || flag);
}

export function addHours(iso, hours) {
  const base = iso ? new Date(iso) : new Date();
  return new Date(base.getTime() + Number(hours || 0) * 3600000).toISOString();
}

export function localStamp(iso) {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function inputDateTime(iso) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

export function fromInputDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function baseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function rowData(row) {
  return safeJsonParse(row?.data_json, {});
}
