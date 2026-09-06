import { DEFAULT_ADMIN_EMAIL, DEFAULT_FUNCTION_SUB_FUNCTIONS, DEFAULT_FUNCTIONS, DEFAULT_TEAM1_MANAGERS } from "./constants.js";
import { createGmailDraft, gmailConfigured } from "./email.js";
import {
  addHours,
  analyzeFlags,
  clean,
  flagLabels,
  fromInputDateTime,
  isMaterialChange,
  norm,
  nowIso,
  parseBool,
  safeJsonParse,
  summarizeChange,
} from "./util.js";

export async function ensureBoot(env) {
  const row = await env.DB.prepare("SELECT id FROM cycles ORDER BY id DESC LIMIT 1").first();
  if (!row) {
    await env.DB.prepare(
      `INSERT INTO cycles (name, quarter_label, close_at, admin_email)
       VALUES (?, ?, ?, ?)`
    )
      .bind("Current cycle", "Current cycle", addHours(nowIso(), 168), primaryAdminEmail(env))
      .run();
  }
  const cycle = await getCycle(env);
  const routes = await env.DB.prepare("SELECT COUNT(*) AS count FROM routing_rules WHERE cycle_id = ?")
    .bind(cycle.id)
    .first();
  if (!routes.count) {
    const seedRoutes = bootstrapRoutes(env);
    const statements = seedRoutes.map((route, index) =>
      env.DB.prepare(
        `INSERT INTO routing_rules (cycle_id, department, sub_department, owner_name, owner_email, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(cycle.id, route.department, route.sub_department || "", route.owner_name, route.owner_email || "", index)
    );
    if (statements.length) {
      await env.DB.batch(statements);
    }
  }
  const team1 = await env.DB.prepare("SELECT COUNT(*) AS count FROM team1_managers WHERE cycle_id = ?")
    .bind(cycle.id)
    .first();
  if (!team1.count) {
    const seedManagers = bootstrapTeam1Managers(env);
    const statements = seedManagers.map((manager) =>
      env.DB.prepare(
        `INSERT INTO team1_managers (cycle_id, manager_name, manager_name_norm, manager_email, manager_email_norm)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(cycle.id, manager.name, norm(manager.name), manager.email || "", norm(manager.email || ""))
    );
    if (statements.length) {
      await env.DB.batch(statements);
    }
  }
  return cycle;
}

function primaryAdminEmail(env) {
  return String(env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL)
    .split(",")
    .map(clean)
    .filter(Boolean)[0] || DEFAULT_ADMIN_EMAIL;
}

function bootstrapRoutes(env) {
  const parsed = safeJsonParse(env.FUNCTION_ROUTES_JSON, []);
  if (!Array.isArray(parsed)) {
    return defaultRoutes();
  }
  const routes = parsed
    .map((route) => ({
      department: clean(route?.department),
      sub_department: clean(route?.sub_department),
      owner_name: clean(route?.owner_name),
      owner_email: clean(route?.owner_email),
    }))
    .filter((route) => route.department && route.owner_name);
  return routes.length ? routes : defaultRoutes();
}

function defaultRoutes() {
  const rows = [];
  for (const department of DEFAULT_FUNCTIONS) {
    const subFunctions = DEFAULT_FUNCTION_SUB_FUNCTIONS[department] || [""];
    for (const subDepartment of subFunctions) {
      rows.push({
        department,
        sub_department: subDepartment,
        owner_name: "Owner TBD",
        owner_email: "",
      });
    }
  }
  return rows;
}

function bootstrapTeam1Managers(env) {
  const parsed = safeJsonParse(env.TEAM1_MANAGERS_JSON, []);
  if (!Array.isArray(parsed) || !parsed.length) {
    return DEFAULT_TEAM1_MANAGERS.map((name) => ({ name, email: "" }));
  }
  return parsed
    .map((manager) => {
      if (typeof manager === "string") {
        return { name: clean(manager), email: "" };
      }
      return { name: clean(manager?.name), email: clean(manager?.email) };
    })
    .filter((manager) => manager.name);
}

export async function getCycle(env) {
  return env.DB.prepare("SELECT * FROM cycles ORDER BY id DESC LIMIT 1").first();
}

export async function updateCycle(env, data, actor) {
  const cycle = await getCycle(env);
  const before = JSON.stringify(cycle);
  const closeAt = fromInputDateTime(data.close_at) || cycle.close_at;
  await env.DB.prepare(
    `UPDATE cycles
     SET name = ?, quarter_label = ?, state = ?, application_open = ?, edit_open = ?,
         close_at = ?, upcoming_text = ?, manager_due_hours = ?, manager_reminder_hours = ?,
         function_due_hours = ?, function_reminder_hours = ?, daily_digest_time = ?,
         admin_email = ?, aop_required = ?, allow_public_test_mode = ?,
         manager_rework_send_mode = ?, function_rework_send_mode = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      clean(data.name) || cycle.name,
      clean(data.quarter_label) || cycle.quarter_label,
      clean(data.state) || cycle.state,
      parseBool(data.application_open) ? 1 : 0,
      parseBool(data.edit_open) ? 1 : 0,
      closeAt,
      clean(data.upcoming_text) || cycle.upcoming_text,
      Number(data.manager_due_hours || cycle.manager_due_hours),
      Number(data.manager_reminder_hours || cycle.manager_reminder_hours),
      Number(data.function_due_hours || cycle.function_due_hours),
      Number(data.function_reminder_hours || cycle.function_reminder_hours),
      clean(data.daily_digest_time) || cycle.daily_digest_time,
      clean(data.admin_email) || cycle.admin_email,
      parseBool(data.aop_required) ? 1 : 0,
      parseBool(data.allow_public_test_mode) ? 1 : 0,
      clean(data.manager_rework_send_mode) || cycle.manager_rework_send_mode,
      clean(data.function_rework_send_mode) || cycle.function_rework_send_mode,
      nowIso(),
      cycle.id
    )
    .run();
  const after = await getCycle(env);
  await audit(env, cycle.id, actor, "cycle", cycle.id, "settings_updated", before, JSON.stringify(after));
  return after;
}

export async function submitApplication(env, cycle, user, input, source = "applicant") {
  if (source === "applicant") {
    input.applicant_name = user.name;
    input.applicant_email = user.email;
  }
  const data = normalizeSubmissionData(user, input);
  const flags = analyzeFlags(data, cycle);
  if (source === "applicant") {
    validateApplicantInput(data, cycle, flags);
  }

  const existing = await env.DB.prepare(
    `SELECT s.*, v.data_json
     FROM submissions s
     LEFT JOIN submission_versions v ON v.id = s.latest_version_id
     WHERE s.cycle_id = ? AND s.applicant_email_norm = ?`
  )
    .bind(cycle.id, norm(data.applicant_email))
    .first();

  const beforeData = existing ? safeJsonParse(existing.data_json, {}) : null;
  const material = isMaterialChange(beforeData, data);
  const changeSummary = summarizeChange(beforeData, data);
  const team1Skip = await isTeam1Manager(env, cycle.id, data.manager_name, data.manager_email);

  let submissionId;
  let versionNo = 1;
  const now = nowIso();

  if (existing) {
    submissionId = existing.id;
    const version = await env.DB.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM submission_versions WHERE submission_id = ?")
      .bind(submissionId)
      .first();
    versionNo = version.next_version || 1;
    let managerStatus = existing.manager_status;
    let managerRecheck = existing.manager_recheck_needed;
    if (team1Skip) {
      managerStatus = "skipped";
      managerRecheck = 0;
    } else if (material && existing.manager_status === "approved" && !(await hasManagerOkAfter(env, cycle.id, submissionId, now))) {
      managerStatus = "recheck_needed";
      managerRecheck = 1;
    }
    const status = flags.length
      ? "needs_admin_review"
      : managerStatus === "recheck_needed"
        ? "manager_recheck_needed"
        : existing.status === "needs_admin_review"
          ? "submitted"
          : existing.status;
    await env.DB.prepare(
      `UPDATE submissions
       SET applicant_email_norm = ?, applicant_email = ?, applicant_name = ?, login_user_id = ?, manager_name = ?, manager_email = ?,
           manager_email_norm = ?, department = ?, sub_department = ?, manager_status = ?,
           status = ?,
           function_status = CASE WHEN ? = 1 THEN 'not_ready' ELSE function_status END,
           manager_recheck_needed = ?, objective_flags_json = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        norm(data.applicant_email),
        data.applicant_email,
        data.applicant_name,
        user.id,
        data.manager_name,
        data.manager_email,
        norm(data.manager_email),
        data.department,
        data.sub_department,
        managerStatus,
        status,
        material ? 1 : 0,
        managerRecheck,
        JSON.stringify(flags),
        now,
        submissionId
      )
      .run();
  } else {
    const result = await env.DB.prepare(
      `INSERT INTO submissions
       (cycle_id, applicant_email_norm, applicant_email, applicant_name, login_user_id,
        manager_name, manager_email, manager_email_norm, department, sub_department,
        status, manager_status, function_status, objective_flags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        cycle.id,
        norm(data.applicant_email),
        data.applicant_email,
        data.applicant_name,
        user.id,
        data.manager_name,
        data.manager_email,
        norm(data.manager_email),
        data.department,
        data.sub_department,
        flags.length ? "needs_admin_review" : "submitted",
        team1Skip ? "skipped" : "pending",
        "not_ready",
        JSON.stringify(flags),
        now,
        now
      )
      .run();
    submissionId = result.meta.last_row_id;
  }

  const versionResult = await env.DB.prepare(
    `INSERT INTO submission_versions
     (submission_id, version_no, source, editor_email, data_json, change_summary, material_change, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(submissionId, versionNo, source, user.email, JSON.stringify(data), changeSummary, material ? 1 : 0, now)
    .run();
  const versionId = versionResult.meta.last_row_id;

  await env.DB.prepare("UPDATE submissions SET latest_version_id = ?, updated_at = ? WHERE id = ?")
    .bind(versionId, now, submissionId)
    .run();

  await audit(
    env,
    cycle.id,
    user.email,
    "submission",
    submissionId,
    existing ? "submission_updated" : "submission_created",
    existing ? existing.data_json : null,
    JSON.stringify(data)
  );

  if (existing && material && existing.manager_status === "approved") {
    await createTask(
      env,
      cycle.id,
      submissionId,
      null,
      "manager_recheck",
      `Manager recheck needed: ${data.applicant_name}`,
      `Material fields changed after manager approval: ${changeSummary}`,
      "high",
      addHours(now, 24)
    );
    await markOutdatedDrafts(env, cycle.id, submissionId);
    await draftOutdatedThreadNotices(env, cycle.id, submissionId, data, changeSummary);
  }

  return getSubmission(env, submissionId);
}

function normalizeSubmissionData(user, input) {
  return {
    applicant_name: clean(input.applicant_name || user.name),
    applicant_email: clean(input.applicant_email || user.email),
    manager_name: normalizeManagerName(input.manager_name, input.manager_email),
    manager_email: clean(input.manager_email),
    department: clean(input.department),
    sub_department: clean(input.sub_department),
    regular_okr: clean(input.regular_okr),
    multiplier_target: clean(input.multiplier_target),
    baseline: clean(input.baseline),
    aop: clean(input.aop),
    team_vision: clean(input.team_vision),
    flywheel_parts: clean(input.flywheel_parts),
    flywheel: clean(input.flywheel),
    manager_aligned: parseBool(input.manager_aligned) ? "yes" : "",
    support_required: clean(input.support_required),
  };
}

function normalizeManagerName(name, email) {
  const given = titleCaseName(clean(name));
  const fromEmail = managerNameFromEmail(email);
  if (!fromEmail) {
    return given;
  }
  const givenNorm = norm(given);
  const emailNorm = norm(fromEmail);
  const givenParts = givenNorm.split(/\s+/).filter(Boolean);
  const emailParts = emailNorm.split(/\s+/).filter(Boolean);
  if (!givenNorm || givenNorm === emailNorm) {
    return fromEmail;
  }
  if (givenParts.length < emailParts.length && givenParts[0] === emailParts[0]) {
    return fromEmail;
  }
  if (givenNorm.length <= 8 && emailNorm.startsWith(givenNorm)) {
    return fromEmail;
  }
  return given;
}

function managerNameFromEmail(email) {
  const local = clean(email).split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter((part) => /^[a-z]+$/i.test(part) && part.length > 1);
  if (parts.length < 2) {
    return "";
  }
  return parts.map(titleCaseWord).join(" ");
}

function titleCaseName(value) {
  return value.split(/\s+/).filter(Boolean).map(titleCaseWord).join(" ");
}

function titleCaseWord(value) {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : "";
}

function validateApplicantInput(data, cycle, flags) {
  const blockers = [...flags];
  if (!cycle.aop_required) {
    const i = blockers.indexOf("blank_required");
    if (i >= 0 && clean(data.aop)) {
      blockers.splice(i, 1);
    }
  }
  if (blockers.length) {
    throw new Error(`Fix before submit: ${flagLabels(blockers).join("; ")}`);
  }
}

async function hasManagerOkAfter(env, cycleId, submissionId, sinceIso) {
  const row = await env.DB.prepare(
    `SELECT id FROM email_events
     WHERE cycle_id = ? AND submission_id = ? AND classification = 'approval'
       AND created_at >= ?
     ORDER BY id DESC LIMIT 1`
  )
    .bind(cycleId, submissionId, sinceIso)
    .first();
  return Boolean(row);
}

async function markOutdatedDrafts(env, cycleId, submissionId) {
  await env.DB.prepare(
    `UPDATE approval_items
     SET status = 'stale_draft', updated_at = ?
     WHERE submission_id = ? AND request_id IN (
       SELECT id FROM approval_requests WHERE cycle_id = ? AND status = 'draft'
     )`
  )
    .bind(nowIso(), submissionId, cycleId)
    .run();
}

async function draftOutdatedThreadNotices(env, cycleId, submissionId, data, changeSummary) {
  const rows = await env.DB.prepare(
    `SELECT ar.*
     FROM approval_requests ar
     JOIN approval_items ai ON ai.request_id = ar.id
     WHERE ar.cycle_id = ? AND ai.submission_id = ?
       AND ar.status = 'sent' AND ar.gmail_thread_id IS NOT NULL`
  )
    .bind(cycleId, submissionId)
    .all();
  for (const request of rows.results || []) {
    const body = `Hi ${request.reviewer_name},

${data.applicant_name} updated their Multiplier application after this thread was sent.

Changed fields: ${changeSummary}

Latest version:
Regular OKR: ${data.regular_okr || "-"}
Baseline: ${data.baseline || "-"}
AOP: ${data.aop || "-"}
Multiplier target: ${data.multiplier_target || "-"}

Please review this latest version.

Best,
Team Multipliers`;
    if (gmailConfigured(env)) {
      const result = await createGmailDraft(env, {
        to: request.reviewer_email,
        subject: `Updated application: ${data.applicant_name}`,
        body,
        threadId: request.gmail_thread_id,
      });
      const message = result.message || result;
      await env.DB.prepare(
        `INSERT INTO email_events
         (cycle_id, request_id, submission_id, direction, gmail_thread_id, gmail_message_id, to_email, subject, body_text, classification)
         VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, 'outdated_update_draft')`
      )
        .bind(cycleId, request.id, submissionId, message.threadId || request.gmail_thread_id, message.id || "", request.reviewer_email, `Updated application: ${data.applicant_name}`, body)
        .run();
    } else {
      await createTask(env, cycleId, submissionId, request.id, "outdated_email_draft", `Draft updated thread: ${data.applicant_name}`, body, "high", "");
    }
  }
}

export async function isTeam1Manager(env, cycleId, managerName, managerEmail) {
  const row = await env.DB.prepare(
    `SELECT id FROM team1_managers
     WHERE cycle_id = ? AND active = 1
       AND (manager_name_norm = ? OR (manager_email_norm != '' AND manager_email_norm = ?))
     LIMIT 1`
  )
    .bind(cycleId, norm(managerName), norm(managerEmail))
    .first();
  return Boolean(row);
}

export async function getLatestSubmissions(env, cycleId, filters = {}) {
  const params = [cycleId];
  const where = ["s.cycle_id = ?"];
  if (filters.q) {
    where.push("(s.applicant_name LIKE ? OR s.applicant_email LIKE ? OR s.manager_name LIKE ? OR s.department LIKE ? OR v.data_json LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like, like, like);
  }
  if (filters.department) {
    where.push("s.department = ?");
    params.push(filters.department);
  }
  if (filters.status) {
    where.push("(s.manager_status = ? OR s.function_status = ? OR s.final_status = ? OR s.status = ?)");
    params.push(filters.status, filters.status, filters.status, filters.status);
  }
  const rows = await env.DB.prepare(
    `SELECT s.*, v.data_json, v.version_no, v.created_at AS version_created_at
     FROM submissions s
     LEFT JOIN submission_versions v ON v.id = s.latest_version_id
     WHERE ${where.join(" AND ")}
     ORDER BY s.updated_at DESC`
  )
    .bind(...params)
    .all();
  return rows.results || [];
}

export async function getSubmission(env, id) {
  return env.DB.prepare(
    `SELECT s.*, v.data_json, v.version_no, v.created_at AS version_created_at
     FROM submissions s
     LEFT JOIN submission_versions v ON v.id = s.latest_version_id
     WHERE s.id = ?`
  )
    .bind(id)
    .first();
}

export async function getSubmissionByEmail(env, cycleId, email) {
  return env.DB.prepare(
    `SELECT s.*, v.data_json, v.version_no, v.created_at AS version_created_at
     FROM submissions s
     LEFT JOIN submission_versions v ON v.id = s.latest_version_id
     WHERE s.cycle_id = ? AND s.applicant_email_norm = ?`
  )
    .bind(cycleId, norm(email))
    .first();
}

export async function getVersions(env, submissionId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM submission_versions
     WHERE submission_id = ?
     ORDER BY version_no DESC`
  )
    .bind(submissionId)
    .all();
  return rows.results || [];
}

export async function restoreVersion(env, cycleId, submissionId, versionId, actor) {
  const version = await env.DB.prepare("SELECT * FROM submission_versions WHERE id = ? AND submission_id = ?")
    .bind(versionId, submissionId)
    .first();
  if (!version) {
    throw new Error("Version not found");
  }
  const cycle = await getCycle(env);
  const current = await getSubmission(env, submissionId);
  if (!current || current.cycle_id !== cycleId) {
    throw new Error("Submission not found");
  }
  const data = safeJsonParse(version.data_json, {});
  const flags = analyzeFlags(data, cycle);
  const beforeData = safeJsonParse(current.data_json, {});
  const material = isMaterialChange(beforeData, data);
  const team1Skip = await isTeam1Manager(env, cycleId, data.manager_name, data.manager_email);
  const nextVersion = await env.DB.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM submission_versions WHERE submission_id = ?")
    .bind(submissionId)
    .first();
  const managerStatus = team1Skip
    ? "skipped"
    : material && current.manager_status === "approved"
      ? "recheck_needed"
      : current.manager_status;
  const status = flags.length
    ? "needs_admin_review"
    : managerStatus === "recheck_needed"
      ? "manager_recheck_needed"
      : current.status;
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE submissions
     SET applicant_email_norm = ?, applicant_email = ?, applicant_name = ?, manager_name = ?,
         manager_email = ?, manager_email_norm = ?, department = ?, sub_department = ?,
         status = ?, manager_status = ?, function_status = CASE WHEN ? = 1 THEN 'not_ready' ELSE function_status END,
         manager_recheck_needed = ?, objective_flags_json = ?, updated_at = ?
     WHERE id = ? AND cycle_id = ?`
  )
    .bind(
      norm(data.applicant_email),
      data.applicant_email,
      data.applicant_name,
      data.manager_name,
      data.manager_email,
      norm(data.manager_email),
      data.department,
      data.sub_department,
      status,
      managerStatus,
      material ? 1 : 0,
      managerStatus === "recheck_needed" ? 1 : 0,
      JSON.stringify(flags),
      now,
      submissionId,
      cycleId
    )
    .run();
  const result = await env.DB.prepare(
    `INSERT INTO submission_versions
     (submission_id, version_no, source, editor_email, data_json, change_summary, material_change, created_at)
     VALUES (?, ?, 'admin_restore', ?, ?, ?, ?, ?)`
  )
    .bind(submissionId, nextVersion.next_version || 1, actor, JSON.stringify(data), `Restored v${version.version_no}`, material ? 1 : 0, now)
    .run();
  await env.DB.prepare("UPDATE submissions SET latest_version_id = ? WHERE id = ?").bind(result.meta.last_row_id, submissionId).run();
  await audit(env, cycleId, actor, "submission", submissionId, "version_restored", current.data_json, JSON.stringify(data));
  if (material && current.manager_status === "approved") {
    await createTask(env, cycleId, submissionId, null, "manager_recheck", `Manager recheck needed: ${data.applicant_name}`, `Admin restored material version v${version.version_no}.`, "high", addHours(now, 24));
    await markOutdatedDrafts(env, cycleId, submissionId);
    await draftOutdatedThreadNotices(env, cycleId, submissionId, data, `Restored v${version.version_no}`);
  }
  return getSubmission(env, submissionId);
}

export async function dashboardStats(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN manager_status = 'pending' OR manager_status = 'recheck_needed' THEN 1 ELSE 0 END) AS manager_pending,
       SUM(CASE WHEN function_status = 'pending' THEN 1 ELSE 0 END) AS function_pending,
       SUM(CASE WHEN final_status = 'finalized' THEN 1 ELSE 0 END) AS finalized,
       SUM(CASE WHEN status = 'needs_admin_review' OR objective_flags_json != '[]' THEN 1 ELSE 0 END) AS blockers
     FROM submissions WHERE cycle_id = ?`
  )
    .bind(cycleId)
    .first();
  const versionRows = await env.DB.prepare(
    "SELECT COUNT(*) AS versions FROM submission_versions WHERE submission_id IN (SELECT id FROM submissions WHERE cycle_id = ?)"
  )
    .bind(cycleId)
    .first();
  const taskRows = await env.DB.prepare(
    "SELECT COUNT(*) AS open_tasks FROM tasks WHERE cycle_id = ? AND status = 'open'"
  )
    .bind(cycleId)
    .first();
  return { ...(rows || {}), ...(versionRows || {}), ...(taskRows || {}) };
}

export async function deptSplit(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT department, COUNT(*) AS count
     FROM submissions
     WHERE cycle_id = ?
     GROUP BY department
     ORDER BY count DESC, department ASC`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function listTasks(env, cycleId, onlyOpen = true) {
  const rows = await env.DB.prepare(
    `SELECT t.*, s.applicant_name, s.manager_name, s.manager_email
     FROM tasks t
     LEFT JOIN submissions s ON s.id = t.submission_id
     WHERE t.cycle_id = ? ${onlyOpen ? "AND t.status = 'open'" : ""}
     ORDER BY CASE priority WHEN 'blocker' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, COALESCE(t.due_at, t.created_at) ASC`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function listApplicantTasks(env, cycleId, submissionId) {
  const rows = await env.DB.prepare(
    `SELECT *
     FROM tasks
     WHERE cycle_id = ? AND submission_id = ? AND status = 'open'
     ORDER BY CASE priority WHEN 'blocker' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at DESC`
  )
    .bind(cycleId, submissionId)
    .all();
  return rows.results || [];
}

export async function completeTask(env, cycleId, taskId, actor) {
  const before = await env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND cycle_id = ?").bind(taskId, cycleId).first();
  await env.DB.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND cycle_id = ?")
    .bind(nowIso(), nowIso(), taskId, cycleId)
    .run();
  await audit(env, cycleId, actor, "task", taskId, "task_completed", JSON.stringify(before), null);
}

export async function createTask(env, cycleId, submissionId, requestId, kind, title, details, priority = "normal", dueAt = "") {
  const existing = await env.DB.prepare(
    `SELECT id, details FROM tasks
     WHERE cycle_id = ? AND COALESCE(submission_id, 0) = COALESCE(?, 0)
       AND kind = ? AND status = 'open'
     LIMIT 1`
  )
    .bind(cycleId, submissionId, kind)
    .first();
  if (existing) {
    const mergedDetails = kind === "rework" && existing.details && !existing.details.includes(details)
      ? `${existing.details}\n\n${details}`
      : details;
    await env.DB.prepare("UPDATE tasks SET details = ?, priority = ?, due_at = ?, updated_at = ? WHERE id = ?")
      .bind(mergedDetails, priority, dueAt, nowIso(), existing.id)
      .run();
    return existing.id;
  }
  const result = await env.DB.prepare(
    `INSERT INTO tasks (cycle_id, request_id, submission_id, kind, title, details, priority, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(cycleId, requestId, submissionId, kind, title, details, priority, dueAt)
    .run();
  return result.meta.last_row_id;
}

export async function audit(env, cycleId, actor, entityType, entityId, action, beforeJson, afterJson) {
  await env.DB.prepare(
    `INSERT INTO audit_events
     (cycle_id, actor_email, entity_type, entity_id, action, before_json, after_json, undo_until, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(cycleId, actor || "system", entityType, entityId, action, beforeJson, afterJson, addHours(nowIso(), 2), nowIso())
    .run();
}

export async function auditForEntity(env, cycleId, entityType, entityId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM audit_events
     WHERE cycle_id = ? AND entity_type = ? AND entity_id = ?
     ORDER BY id DESC LIMIT 80`
  )
    .bind(cycleId, entityType, entityId)
    .all();
  return rows.results || [];
}

export async function auditList(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM audit_events
     WHERE cycle_id = ?
     ORDER BY id DESC LIMIT 120`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function listRoutes(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM routing_rules
     WHERE cycle_id = ?
     ORDER BY department, sub_department, sort_order`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function updateRouteEmails(env, cycleId, input, actor) {
  const routes = await listRoutes(env, cycleId);
  const statements = [];
  for (const route of routes) {
    if (parseBool(input[`route_delete_${route.id}`])) {
      statements.push(env.DB.prepare("DELETE FROM routing_rules WHERE id = ? AND cycle_id = ?").bind(route.id, cycleId));
      continue;
    }
    const department = clean(input[`route_department_${route.id}`]) || route.department;
    const subDepartment = clean(input[`route_sub_department_${route.id}`]);
    const ownerName = clean(input[`route_owner_name_${route.id}`]) || route.owner_name;
    const email = clean(input[`route_owner_email_${route.id}`]);
    const active = parseBool(input[`route_active_${route.id}`]) ? 1 : 0;
    statements.push(
      env.DB.prepare(
        "UPDATE routing_rules SET department = ?, sub_department = ?, owner_name = ?, owner_email = ?, active = ? WHERE id = ? AND cycle_id = ?"
      ).bind(department, subDepartment, ownerName, email, active, route.id, cycleId)
    );
  }
  if (statements.length) {
    await env.DB.batch(statements);
  }
  await audit(env, cycleId, actor, "routes", cycleId, "route_emails_updated", null, JSON.stringify(input));
}

export async function addRoute(env, cycleId, input, actor) {
  const department = clean(input.department);
  const ownerName = clean(input.owner_name);
  if (!department || !ownerName) {
    throw new Error("Department and owner name are required");
  }
  const result = await env.DB.prepare(
    `INSERT INTO routing_rules (cycle_id, department, sub_department, owner_name, owner_email, active, sort_order)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(cycleId, department, clean(input.sub_department), ownerName, clean(input.owner_email), Date.now())
    .run();
  await audit(env, cycleId, actor, "routes", result.meta.last_row_id, "route_added", null, JSON.stringify(input));
  return result.meta.last_row_id;
}

export async function listTeam1(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT * FROM team1_managers WHERE cycle_id = ? ORDER BY manager_name`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function addTeam1Manager(env, cycleId, input, actor) {
  const name = clean(input.manager_name);
  if (!name) {
    throw new Error("Manager name is required");
  }
  const email = clean(input.manager_email);
  const result = await env.DB.prepare(
    `INSERT INTO team1_managers (cycle_id, manager_name, manager_name_norm, manager_email, manager_email_norm, active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(cycle_id, manager_name_norm) DO UPDATE SET
       manager_email = excluded.manager_email,
       manager_email_norm = excluded.manager_email_norm,
       active = 1`
  )
    .bind(cycleId, name, norm(name), email, norm(email))
    .run();
  await audit(env, cycleId, actor, "team1", cycleId, "team1_manager_added", null, JSON.stringify(input));
  return result.meta.last_row_id;
}

export async function saveSnapshot(env, cycleId, label, actor) {
  const rows = await getLatestSubmissions(env, cycleId);
  const data = rows.map((row) => ({ submission: row, data: safeJsonParse(row.data_json, {}) }));
  const result = await env.DB.prepare(
    "INSERT INTO dataset_snapshots (cycle_id, label, data_json, actor_email) VALUES (?, ?, ?, ?)"
  )
    .bind(cycleId, clean(label) || "Snapshot", JSON.stringify(data), actor)
    .run();
  await audit(env, cycleId, actor, "snapshot", result.meta.last_row_id, "snapshot_created", null, JSON.stringify({ count: data.length }));
  return result.meta.last_row_id;
}

export async function listSnapshots(env, cycleId) {
  const rows = await env.DB.prepare(
    "SELECT id, label, actor_email, created_at FROM dataset_snapshots WHERE cycle_id = ? ORDER BY id DESC LIMIT 25"
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function finalizeDataset(env, cycleId, actor) {
  const rows = await getLatestSubmissions(env, cycleId);
  const unresolved = rows.filter((row) => !["approved", "rejected"].includes(row.function_status));
  if (unresolved.length) {
    throw new Error(`Cannot finalize yet. ${unresolved.length} applicants still need function closure.`);
  }
  const ready = rows.filter((row) => row.function_status === "approved");
  if (!ready.length) {
    throw new Error("No function-approved applicants to finalize");
  }
  const statements = [];
  for (const row of ready) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO final_participants
         (cycle_id, submission_id, version_id, data_json, finalized_by_email)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cycle_id, submission_id) DO UPDATE SET
           version_id = excluded.version_id,
           data_json = excluded.data_json,
           finalized_by_email = excluded.finalized_by_email,
           finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      ).bind(cycleId, row.id, row.latest_version_id, row.data_json, actor)
    );
    statements.push(
      env.DB.prepare("UPDATE submissions SET final_status = 'finalized', status = 'finalized', updated_at = ? WHERE id = ?")
        .bind(nowIso(), row.id)
    );
  }
  statements.push(env.DB.prepare("UPDATE cycles SET state = 'finalized', finalized_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), cycleId));
  await env.DB.batch(statements);
  await saveSnapshot(env, cycleId, "Final dataset", actor);
  await audit(env, cycleId, actor, "cycle", cycleId, "dataset_finalized", null, JSON.stringify({ count: ready.length }));
  return ready.length;
}

export async function finalParticipants(env, cycleId) {
  const rows = await env.DB.prepare(
    `SELECT fp.*, s.applicant_name, s.applicant_email, s.department, s.sub_department
     FROM final_participants fp
     JOIN submissions s ON s.id = fp.submission_id
     WHERE fp.cycle_id = ?
     ORDER BY s.department, s.applicant_name`
  )
    .bind(cycleId)
    .all();
  return rows.results || [];
}

export async function startNewQuarter(env, actor, input = {}) {
  const current = await getCycle(env);
  if (current.state !== "finalized") {
    throw new Error("Finalize current cycle before starting next quarter");
  }
  const stats = await dashboardStats(env, current.id);
  const flags = await env.DB.prepare(
    `SELECT objective_flags_json, COUNT(*) AS count
     FROM submissions
     WHERE cycle_id = ?
     GROUP BY objective_flags_json`
  )
    .bind(current.id)
    .all();
  await env.DB.prepare("INSERT INTO cycle_memory (cycle_id, kind, value_json) VALUES (?, ?, ?)")
    .bind(current.id, "cycle_learning_snapshot", JSON.stringify({ stats, flags: flags.results || [] }))
    .run();
  await env.DB.prepare(
    `DELETE FROM submission_versions
     WHERE submission_id IN (SELECT id FROM submissions WHERE cycle_id = ?)
       AND id NOT IN (SELECT latest_version_id FROM submissions WHERE cycle_id = ?)`
  )
    .bind(current.id, current.id)
    .run();
  const result = await env.DB.prepare(
    `INSERT INTO cycles
     (name, quarter_label, close_at, admin_email, manager_due_hours, manager_reminder_hours,
      function_due_hours, function_reminder_hours, daily_digest_time, aop_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      clean(input.name) || "Next cycle",
      clean(input.quarter_label) || clean(input.name) || "Next cycle",
      addHours(nowIso(), 168),
      current.admin_email,
      current.manager_due_hours,
      current.manager_reminder_hours,
      current.function_due_hours,
      current.function_reminder_hours,
      current.daily_digest_time,
      current.aop_required
    )
    .run();
  const newCycleId = result.meta.last_row_id;
  const routes = await listRoutes(env, current.id);
  const routeStatements = routes.map((route, index) =>
    env.DB.prepare(
      `INSERT INTO routing_rules (cycle_id, department, sub_department, owner_name, owner_email, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(newCycleId, route.department, route.sub_department || "", route.owner_name, route.owner_email || "", route.active, index)
  );
  const team = await listTeam1(env, current.id);
  const teamStatements = team.map((manager) =>
    env.DB.prepare(
      `INSERT INTO team1_managers (cycle_id, manager_name, manager_name_norm, manager_email, manager_email_norm, active)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(newCycleId, manager.manager_name, manager.manager_name_norm, manager.manager_email || "", manager.manager_email_norm || "", manager.active)
  );
  await env.DB.batch([...routeStatements, ...teamStatements]);
  await audit(env, current.id, actor, "cycle", current.id, "quarter_archived", null, JSON.stringify({ kept: "latest_submission_versions_only" }));
  await audit(env, newCycleId, actor, "cycle", newCycleId, "quarter_started", null, JSON.stringify({ from_cycle_id: current.id }));
  return getCycle(env);
}
