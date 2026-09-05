import { createTask, getCycle, getLatestSubmissions, isTeam1Manager, listRoutes } from "./db.js";
import { SENDER_EMAIL } from "./constants.js";
import { classifyReply, createGmailDraft, extractMessage, getThread, gmailConfigured, sendGmail } from "./email.js";
import { addHours, baseUrl, clean, flagLabels, newToken, norm, nowIso, rowData, safeJsonParse } from "./util.js";

export async function listApprovalRequests(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT ar.*,
       COUNT(ai.id) AS item_count,
       SUM(CASE WHEN ai.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
     FROM approval_requests ar
     LEFT JOIN approval_items ai ON ai.request_id = ar.id
     WHERE ar.cycle_id = ?
     GROUP BY ar.id
     ORDER BY ar.updated_at DESC`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function prepareManagerRequests(env, cycle, request) {
  const rows = await getLatestSubmissions(env, cycle.id);
  const groups = new Map();
  for (const row of rows) {
    const flags = safeJsonParse(row.objective_flags_json, []);
    const data = rowData(row);
    if (await isTeam1Manager(env, cycle.id, row.manager_name, row.manager_email)) {
      if (row.manager_status !== "skipped") {
        await env.DB.prepare("UPDATE submissions SET manager_status = 'skipped', manager_recheck_needed = 0, updated_at = ? WHERE id = ?")
          .bind(nowIso(), row.id)
          .run();
      }
      continue;
    }
    if (flags.length) {
      await createTask(
        env,
        cycle.id,
        row.id,
        null,
        "objective_flags",
        `Fix objective flags: ${row.applicant_name}`,
        flagLabels(flags).join("; "),
        "blocker",
        ""
      );
      continue;
    }
    if (!["pending", "recheck_needed", "rework"].includes(row.manager_status)) {
      continue;
    }
    const key = norm(row.manager_email || row.manager_name);
    if (!groups.has(key)) {
      groups.set(key, {
        reviewer_name: row.manager_name,
        reviewer_email: row.manager_email,
        group_key: `manager:${key}`,
        rows: [],
      });
    }
    groups.get(key).rows.push({ ...row, data });
  }

  const prepared = [];
  for (const group of groups.values()) {
    prepared.push(await upsertApprovalRequest(env, cycle, "manager", group, request));
  }
  return prepared;
}

export async function prepareFunctionRequests(env, cycle, request) {
  const rows = await getLatestSubmissions(env, cycle.id);
  const routes = await listRoutes(env, cycle.id);
  const groups = new Map();
  const blockedDepartments = new Set();

  for (const row of rows) {
    const flags = safeJsonParse(row.objective_flags_json, []);
    if (flags.length) {
      await createTask(env, cycle.id, row.id, null, "function_blocked", `Function email blocked: ${row.applicant_name}`, flagLabels(flags).join("; "), "blocker", "");
      blockedDepartments.add(norm(row.department));
      continue;
    }
    if (!["approved", "rejected", "skipped"].includes(row.manager_status)) {
      await createTask(env, cycle.id, row.id, null, "function_waiting", `Function email waiting: ${row.applicant_name}`, `Manager status: ${row.manager_status}`, "normal", "");
      blockedDepartments.add(norm(row.department));
      continue;
    }
    const matched = matchingRoutes(routes, row);
    if (!matched.length) {
      await createTask(env, cycle.id, row.id, null, "missing_function_route", `Missing function route: ${row.department}`, `Add function head email for ${row.department}/${row.sub_department || "-"}.`, "blocker", "");
      blockedDepartments.add(norm(row.department));
      continue;
    }
    const missing = matched.filter((route) => !clean(route.owner_email));
    if (missing.length) {
      await createTask(env, cycle.id, row.id, null, "missing_function_email", `Missing approver email: ${missing.map((r) => r.owner_name).join(", ")}`, `Add email in Routes before sending ${row.department}.`, "blocker", "");
      blockedDepartments.add(norm(row.department));
    }
  }

  for (const row of rows) {
    const flags = safeJsonParse(row.objective_flags_json, []);
    if (flags.length || blockedDepartments.has(norm(row.department))) {
      continue;
    }
    if (!["approved", "rejected", "skipped"].includes(row.manager_status)) {
      continue;
    }
    const matched = matchingRoutes(routes, row);
    if (!matched.length) {
      await createTask(env, cycle.id, row.id, null, "missing_function_route", `Missing function route: ${row.department}`, `Add function head email for ${row.department}/${row.sub_department || "-"}.`, "blocker", "");
      continue;
    }
    const missing = matched.filter((route) => !clean(route.owner_email));
    if (missing.length) {
      await createTask(env, cycle.id, row.id, null, "missing_function_email", `Missing approver email: ${missing.map((r) => r.owner_name).join(", ")}`, `Add email in Routes before sending ${row.department}.`, "blocker", "");
      continue;
    }
    const owners = uniqueOwners(matched);
    const key = owners.map((owner) => norm(owner.email)).sort().join(",");
    if (!groups.has(key)) {
      groups.set(key, {
        reviewer_name: owners.map((owner) => owner.name).join(", "),
        reviewer_email: owners.map((owner) => owner.email).join(", "),
        group_key: `function:${key}`,
        rows: [],
      });
    }
    groups.get(key).rows.push({ ...row, data: rowData(row), manager_reason: await latestManagerReason(env, row.id) });
  }

  const prepared = [];
  for (const group of groups.values()) {
    const preparedRequest = await upsertApprovalRequest(env, cycle, "function", group, request);
    prepared.push(preparedRequest);
    for (const row of group.rows) {
      await env.DB.prepare("UPDATE submissions SET function_status = 'pending', updated_at = ? WHERE id = ? AND function_status = 'not_ready'")
        .bind(nowIso(), row.id)
        .run();
    }
  }
  return prepared;
}

function uniqueOwners(routes) {
  const map = new Map();
  for (const route of routes) {
    const key = norm(route.owner_email);
    if (!map.has(key)) {
      map.set(key, { name: route.owner_name, email: route.owner_email });
    }
  }
  return [...map.values()];
}

async function latestManagerReason(env, submissionId) {
  const row = await env.DB.prepare(
    `SELECT ai.reason, ai.requested_change
     FROM approval_items ai
     JOIN approval_requests ar ON ar.id = ai.request_id
     WHERE ar.stage = 'manager' AND ai.submission_id = ?
     ORDER BY ai.updated_at DESC LIMIT 1`
  )
    .bind(submissionId)
    .first();
  return row?.reason || row?.requested_change || "";
}

function matchingRoutes(routes, row) {
  const exact = routes.filter(
    (route) =>
      route.active &&
      norm(route.department) === norm(row.department) &&
      route.sub_department &&
      norm(route.sub_department) === norm(row.sub_department)
  );
  const deptOnly = routes.filter(
    (route) =>
      route.active &&
      norm(route.department) === norm(row.department) &&
      !clean(route.sub_department)
  );
  return [...exact, ...deptOnly];
}

async function upsertApprovalRequest(env, cycle, stage, group, request) {
  const token = newToken();
  const reviewUrl = `${baseUrl(request)}/review/${token}`;
  const subject = stage === "manager"
    ? `Multiplier ${cycle.name} applications - ${group.reviewer_name}`
    : `Multiplier ${cycle.name} function approvals - ${group.reviewer_name}`;
  const body = stage === "manager"
    ? managerBody(cycle, group, reviewUrl)
    : functionBody(cycle, group, reviewUrl);

  const existing = await env.DB.prepare("SELECT * FROM approval_requests WHERE cycle_id = ? AND stage = ? AND group_key = ?")
    .bind(cycle.id, stage, group.group_key)
    .first();

  let requestId;
  if (existing) {
    requestId = existing.id;
    await env.DB.prepare(
      `UPDATE approval_requests
       SET reviewer_name = ?, reviewer_email = ?, reviewer_email_norm = ?, subject = ?, body = ?,
           status = CASE WHEN status = 'sent' THEN status ELSE 'draft' END,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(group.reviewer_name, group.reviewer_email, norm(group.reviewer_email), subject, body.replace(token, existing.review_token), nowIso(), existing.id)
      .run();
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO approval_requests
       (cycle_id, stage, reviewer_name, reviewer_email, reviewer_email_norm, group_key, review_token, subject, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(cycle.id, stage, group.reviewer_name, group.reviewer_email, norm(group.reviewer_email), group.group_key, token, subject, body, nowIso(), nowIso())
      .run();
    requestId = result.meta.last_row_id;
  }

  const requestRow = await env.DB.prepare("SELECT * FROM approval_requests WHERE id = ?").bind(requestId).first();
  for (const row of group.rows) {
    await env.DB.prepare(
      `INSERT INTO approval_items (request_id, submission_id, version_id_at_send, status, updated_at)
       VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT(request_id, submission_id) DO UPDATE SET
         version_id_at_send = excluded.version_id_at_send,
         status = CASE WHEN approval_items.status = 'stale_draft' THEN 'pending' ELSE approval_items.status END,
         updated_at = excluded.updated_at`
    )
      .bind(requestId, row.id, row.latest_version_id, nowIso())
      .run();
  }
  return requestRow;
}

function managerBody(cycle, group, reviewUrl) {
  const blocks = group.rows.map(({ applicant_name, data }) => {
    return [
      applicant_name,
      `Regular OKR: ${data.regular_okr || "-"}`,
      `Baseline: ${data.baseline || "-"}`,
      `AOP: ${data.aop || "-"}`,
      `Multiplier target: ${data.multiplier_target || "-"}`,
      `Team vision: ${data.team_vision || "-"}`,
      `Flywheel: ${data.flywheel || "-"}`,
    ].join("\n");
  });
  return `Hi ${group.reviewer_name},

Hope you're doing well.

Sharing Multiplier ${cycle.name} applications from your team. Can you reply naturally with GTG / changes / rejection reason, or use this review page:
${reviewUrl}

${blocks.join("\n\n")}

Please call out if anything needs rework. If you reply here, system will read it and update the approval trail.

Best,
Team Multipliers`;
}

function functionBody(cycle, group, reviewUrl) {
  const bySub = new Map();
  for (const row of group.rows) {
    const key = row.sub_department || "No sub department";
    if (!bySub.has(key)) {
      bySub.set(key, []);
    }
    bySub.get(key).push(row);
  }
  const sections = [...bySub.entries()].map(([sub, rows]) => {
    const items = rows.map(({ applicant_name, manager_status, manager_reason, data }) => {
      const note = manager_status === "skipped"
        ? "Team 1 manager-skipped: direct-report approval included in this mail."
        : manager_status === "rejected"
          ? `Manager rejected with reason; included for your call. Reason: ${manager_reason || "-"}`
          : "Manager approved.";
      return [
        applicant_name,
        note,
        `Regular OKR: ${data.regular_okr || "-"}`,
        `Baseline: ${data.baseline || "-"}`,
        `AOP: ${data.aop || "-"}`,
        `Multiplier target: ${data.multiplier_target || "-"}`,
      ].join("\n");
    });
    return `${sub}\n${items.join("\n\n")}`;
  });
  return `Hi ${group.reviewer_name},

Need your function approval for Multiplier ${cycle.name}. You can reply naturally or use this review page:
${reviewUrl}

Managers have approved rows marked below. Your direct reportees are included here for your approval so they do not get a duplicate manager mail.

${sections.join("\n\n---\n\n")}

Please reply GTG, changes needed, or rejection reason.

Best,
Team Multipliers`;
}

export async function sendOrDraftRequest(env, cycle, requestId, mode, testTo = "") {
  const request = await env.DB.prepare("SELECT * FROM approval_requests WHERE id = ? AND cycle_id = ?")
    .bind(requestId, cycle.id)
    .first();
  if (!request) {
    throw new Error("Approval request not found");
  }
  if (!gmailConfigured(env)) {
    throw new Error("Gmail env missing");
  }
  const to = testTo || request.reviewer_email;
  const subject = testTo ? `[TEST] ${request.subject}` : request.subject;
  const body = testTo ? `${request.body}\n\nTEST ONLY. Real recipient would be ${request.reviewer_email}.` : request.body;
  const payload = { to, subject, body, threadId: request.gmail_thread_id || "" };
  const result = mode === "draft" ? await createGmailDraft(env, payload) : await sendGmail(env, payload);
  const message = result.message || result;
  const classification = testTo ? "test_sent" : mode;
  await env.DB.prepare(
    `INSERT INTO email_events
     (cycle_id, request_id, direction, gmail_thread_id, gmail_message_id, from_email, to_email, subject, body_text, classification)
     VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(cycle.id, request.id, message.threadId || request.gmail_thread_id || "", message.id || result.id || "", env.GMAIL_SENDER || "", to, subject, body, classification)
    .run();
  if (!testTo) {
    await env.DB.prepare(
      `UPDATE approval_requests
       SET status = ?, gmail_thread_id = COALESCE(?, gmail_thread_id), gmail_message_id = COALESCE(?, gmail_message_id),
           sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
           due_at = CASE WHEN ? = 'sent' THEN ? ELSE due_at END,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        mode === "draft" ? "draft" : "sent",
        message.threadId || null,
        message.id || result.id || null,
        mode === "send" ? "sent" : "draft",
        nowIso(),
        mode === "send" ? "sent" : "draft",
        addHours(nowIso(), request.stage === "manager" ? cycle.manager_due_hours : cycle.function_due_hours),
        nowIso(),
        request.id
      )
      .run();
  }
  return result;
}

export async function requestByToken(env, token) {
  return env.DB.prepare("SELECT * FROM approval_requests WHERE review_token = ?").bind(token).first();
}

export async function requestItems(env, requestId) {
  const rows = await env.DB.prepare(
    `SELECT ai.*, s.applicant_name, s.applicant_email, s.department, s.sub_department,
       s.manager_status, s.function_status, s.latest_version_id,
       v.data_json, v.version_no,
       sentv.version_no AS sent_version_no
     FROM approval_items ai
     JOIN submissions s ON s.id = ai.submission_id
     LEFT JOIN submission_versions v ON v.id = s.latest_version_id
     LEFT JOIN submission_versions sentv ON sentv.id = ai.version_id_at_send
     WHERE ai.request_id = ?
     ORDER BY s.department, s.sub_department, s.applicant_name`
  )
    .bind(requestId)
    .all();
  return rows.results || [];
}

export async function recordReviewAction(env, request, itemId, action, note, actorEmail = "") {
  const item = await env.DB.prepare(
    `SELECT ai.*, s.applicant_name, s.applicant_email, s.id AS sid
     FROM approval_items ai
     JOIN submissions s ON s.id = ai.submission_id
     WHERE ai.id = ? AND ai.request_id = ?`
  )
    .bind(itemId, request.id)
    .first();
  if (!item) {
    throw new Error("Review item not found");
  }
  const normalized = action === "approve" ? "approved" : action === "reject" ? "rejected" : "rework";
  await env.DB.prepare(
    `UPDATE approval_items
     SET status = ?, reason = ?, requested_change = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(normalized, normalized === "rejected" ? note : "", normalized === "rework" ? note : "", nowIso(), itemId)
    .run();

  if (request.stage === "manager") {
    await applyManagerAction(env, request, item, normalized, note);
  } else if (request.stage === "function") {
    await applyFunctionAction(env, request, item, normalized, note);
  }
  await maybeConflictDraft(env, request, item.sid, normalized, actorEmail || request.reviewer_email, note);
  await closeRequestIfDone(env, request.id);
}

async function applyManagerAction(env, request, item, status, note) {
  const next = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "rework";
  await env.DB.prepare(
    `UPDATE submissions
     SET manager_status = ?, manager_recheck_needed = 0,
         status = CASE WHEN ? = 'approved' THEN 'manager_approved' WHEN ? = 'rejected' THEN 'manager_rejected' ELSE 'needs_admin_review' END,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(next, next, next, nowIso(), item.sid)
    .run();
  if (next === "rework") {
    await createTask(env, request.cycle_id, item.sid, request.id, "rework", `Applicant rework: ${item.applicant_name}`, note, "high", "");
    await draftRework(env, request, item, note);
  }
}

async function applyFunctionAction(env, request, item, status, note) {
  const next = status === "approved" ? "approved" : status === "rejected" ? "rejected" : "rework";
  await env.DB.prepare(
    `UPDATE submissions
     SET function_status = ?, status = CASE WHEN ? = 'approved' THEN 'function_approved' ELSE 'needs_admin_review' END,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(next, next, nowIso(), item.sid)
    .run();
  if (next === "rework") {
    await createTask(env, request.cycle_id, item.sid, request.id, "rework", `Applicant rework: ${item.applicant_name}`, note, "high", "");
    await draftRework(env, request, item, note);
  }
}

async function draftRework(env, request, item, note) {
  const cycle = await getCycle(env);
  const sendMode = request.stage === "manager" ? cycle.manager_rework_send_mode : cycle.function_rework_send_mode;
  if (!gmailConfigured(env)) {
    await createTask(env, request.cycle_id, item.sid, request.id, "draft_rework_email", `Draft rework mail: ${item.applicant_name}`, note, "normal", "");
    return;
  }
  const body = `Hi ${item.applicant_name},

Your Multiplier application needs one update before we can move it forward.

Requested change:
${note || "-"}

Please edit your form in Multipliers OS and resubmit. We will use the latest submission version.

Best,
Team Multipliers`;
  const mail = {
    to: item.applicant_email,
    cc: request.reviewer_email,
    subject: `Multiplier ${request.stage} rework - ${item.applicant_name}`,
    body,
    threadId: request.gmail_thread_id || "",
  };
  const result = sendMode === "auto" ? await sendGmail(env, mail) : await createGmailDraft(env, mail);
  const message = result.message || result;
  await env.DB.prepare(
    `INSERT INTO email_events
     (cycle_id, request_id, submission_id, direction, gmail_thread_id, gmail_message_id, to_email, subject, body_text, classification)
     VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?)`
  )
    .bind(request.cycle_id, request.id, item.sid, message.threadId || request.gmail_thread_id || "", message.id || "", item.applicant_email, `Multiplier ${request.stage} rework - ${item.applicant_name}`, body, sendMode === "auto" ? "rework_sent" : "rework_draft")
    .run();
}

async function maybeConflictDraft(env, request, submissionId, action, actorEmail, note) {
  const last = await env.DB.prepare(
    `SELECT * FROM email_events
     WHERE request_id = ? AND submission_id IS NULL AND direction = 'inbound'
     ORDER BY id DESC LIMIT 1`
  )
    .bind(request.id)
    .first();
  if (!last) {
    return;
  }
  const prior = last.classification;
  const conflict =
    (prior === "approval" && action !== "approved") ||
    ((prior === "rework" || prior === "rejected") && action === "approved");
  if (!conflict) {
    return;
  }
  const body = `Hi ${request.reviewer_name},

Your email reply and review-page action conflict.

Email read as: ${prior}
Review page action: ${action}

Please reply with which one to use. Notes captured: ${note || "-"}

Best,
Team Multipliers`;
  if (gmailConfigured(env)) {
    await sendGmail(env, {
      to: request.reviewer_email,
      subject: `Clarification needed: ${request.subject}`,
      body,
      threadId: request.gmail_thread_id || "",
    });
  }
  await createTask(env, request.cycle_id, submissionId, request.id, "approval_conflict", `Approval conflict: ${request.reviewer_name}`, body, "blocker", "");
  await env.DB.prepare("UPDATE approval_requests SET status = 'conflict', updated_at = ? WHERE id = ?")
    .bind(nowIso(), request.id)
    .run();
}

async function closeRequestIfDone(env, requestId) {
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM approval_items WHERE request_id = ? AND status = 'pending'")
    .bind(requestId)
    .first();
  if (!pending.count) {
    await env.DB.prepare("UPDATE approval_requests SET status = CASE WHEN status = 'conflict' THEN status ELSE 'done' END, updated_at = ? WHERE id = ?")
      .bind(nowIso(), requestId)
      .run();
  }
}

export async function syncGmailReplies(env, cycle) {
  if (!gmailConfigured(env)) {
    throw new Error("Gmail env missing");
  }
  const pending = await env.DB.prepare(
    `SELECT * FROM approval_requests
     WHERE cycle_id = ? AND status = 'sent' AND gmail_thread_id IS NOT NULL
     ORDER BY sent_at DESC LIMIT 40`
  )
    .bind(cycle.id)
    .all();
  let count = 0;
  for (const request of pending.results || []) {
    const thread = await getThread(env, request.gmail_thread_id);
    const items = await requestItems(env, request.id);
    const names = items.map((item) => item.applicant_name);
    for (const message of thread.messages || []) {
      const parsed = extractMessage(message);
      if (!parsed.id || parsed.id === request.gmail_message_id || norm(parsed.from).includes(norm(env.GMAIL_SENDER || SENDER_EMAIL))) {
        continue;
      }
      const exists = await env.DB.prepare("SELECT id FROM email_events WHERE gmail_message_id = ?").bind(parsed.id).first();
      if (exists) {
        continue;
      }
      const classification = classifyReply(parsed.body, names, parsed.hasAttachments);
      await env.DB.prepare(
        `INSERT INTO email_events
         (cycle_id, request_id, direction, gmail_thread_id, gmail_message_id, from_email, to_email, subject, body_text, classification)
         VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(cycle.id, request.id, parsed.threadId, parsed.id, parsed.from, parsed.to, parsed.subject, parsed.body.slice(0, 4000), classification.type)
        .run();
      count += 1;
      await applyReplyClassification(env, cycle, request, items, classification, parsed.body);
    }
  }
  return count;
}

async function applyReplyClassification(env, cycle, request, items, classification, body) {
  if (classification.type === "approval") {
    for (const item of items.filter((item) => item.status === "pending")) {
      await recordReviewAction(env, request, item.id, "approve", classification.reason, request.reviewer_email);
      await env.DB.prepare(
        `INSERT INTO email_events
         (cycle_id, request_id, submission_id, direction, gmail_thread_id, from_email, body_text, classification)
         VALUES (?, ?, ?, 'system', ?, ?, ?, 'approval')`
      )
        .bind(cycle.id, request.id, item.submission_id, request.gmail_thread_id || "", request.reviewer_email, body.slice(0, 1200))
        .run();
    }
  } else if (classification.type === "rework" || classification.type === "rejected") {
    if (items.length === 1) {
      await recordReviewAction(env, request, items[0].id, classification.type === "rework" ? "rework" : "reject", classification.reason, request.reviewer_email);
    } else {
      await createTask(env, cycle.id, null, request.id, "reply_review", `Review reply from ${request.reviewer_name}`, classification.reason, "blocker", "");
    }
  } else if (classification.type === "discuss") {
    await createTask(env, cycle.id, null, request.id, "manager_discuss_wait", `${request.reviewer_name} will discuss`, "Check for applicant edit or manager reply after 48h.", "normal", addHours(nowIso(), 48));
    await env.DB.prepare("UPDATE approval_requests SET due_at = ?, reminded_at = NULL, updated_at = ? WHERE id = ?")
      .bind(addHours(nowIso(), 48), nowIso(), request.id)
      .run();
  } else {
    await createTask(env, cycle.id, null, request.id, "reply_review", `Unclear reply from ${request.reviewer_name}`, classification.reason, "blocker", "");
  }
}

export async function remindersAndEscalations(env, cycle) {
  if (!gmailConfigured(env)) {
    return { reminders: 0, escalations: 0 };
  }
  const now = nowIso();
  const due = await env.DB.prepare(
    `SELECT * FROM approval_requests
     WHERE cycle_id = ? AND status = 'sent' AND due_at IS NOT NULL AND due_at <= ?
     ORDER BY due_at ASC LIMIT 50`
  )
    .bind(cycle.id, now)
    .all();
  let reminders = 0;
  let escalations = 0;
  for (const request of due.results || []) {
    const graceHours = request.stage === "manager" ? cycle.manager_reminder_hours : cycle.function_reminder_hours;
    if (!request.reminded_at) {
      const body = `Hi ${request.reviewer_name},

Quick reminder on this Multiplier approval thread. Please reply GTG / changes / rejection reason, or use the review page in the earlier mail.

Best,
Team Multipliers`;
      const result = await sendGmail(env, {
        to: request.reviewer_email,
        subject: `Reminder: ${request.subject}`,
        body,
        threadId: request.gmail_thread_id || "",
      });
      await env.DB.prepare("UPDATE approval_requests SET reminded_at = ?, due_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, addHours(now, graceHours), now, request.id)
        .run();
      await env.DB.prepare(
        `INSERT INTO email_events
         (cycle_id, request_id, direction, gmail_thread_id, gmail_message_id, to_email, subject, body_text, classification)
         VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, 'reminder_sent')`
      )
        .bind(cycle.id, request.id, result.threadId || request.gmail_thread_id || "", result.id || "", request.reviewer_email, `Reminder: ${request.subject}`, body)
        .run();
      reminders += 1;
    } else if (!request.escalated_at) {
      await createTask(env, cycle.id, null, request.id, "approval_overdue", `Overdue approval: ${request.reviewer_name}`, request.subject, "blocker", "");
      await env.DB.prepare("UPDATE approval_requests SET escalated_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, request.id)
        .run();
      escalations += 1;
    }
  }
  return { reminders, escalations };
}
