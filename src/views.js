import { DEPARTMENTS, STATUS_LABELS, SUB_DEPARTMENTS } from "./constants.js";
import { escapeAttr, escapeHtml, flagLabels, inputDateTime, localStamp, rowData, safeJsonParse } from "./util.js";

export function layout({ title, user, cycle, active = "home", content }) {
  const admin = user.isAdmin;
  const nav = admin
    ? [
        ["/admin", "Home", "admin"],
        ["/admin/submissions", "Database", "submissions"],
        ["/admin/approvals", "Approvals", "approvals"],
        ["/admin/routes", "Routes", "routes"],
        ["/admin/audit", "Audit", "audit"],
      ]
    : [
        ["/", "Home", "home"],
        ["/apply", "Application", "apply"],
        ["/status", "Status", "status"],
      ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Multipliers OS</title>
  <meta name="description" content="Multipliers OS Phase 1 workflow">
  <style>${style()}</style>
</head>
<body>
  <div class="shell">
    <aside class="side">
      <a class="brand" href="${admin ? "/admin" : "/"}">
        <span class="mark"><i></i><i></i><i></i><i></i></span>
        <span><b>Multipliers OS</b><small>${escapeHtml(cycle.name)}</small></span>
      </a>
      <nav>
        ${nav.map(([href, label, key]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}
      </nav>
      <div class="who">
        <small>Signed in</small>
        <b>${escapeHtml(user.name)}</b>
        <span>${escapeHtml(user.email)}</span>
      </div>
    </aside>
    <main>
      ${content}
    </main>
  </div>
</body>
</html>`;
}

export function applicantHome({ user, cycle, submission, stats, split }) {
  const hasSubmission = Boolean(submission);
  const open = cycle.application_open || cycle.edit_open;
  return `
    <header class="top">
      <div>
        <p class="eyebrow">Applicant face</p>
        <h1>Hello potential multiplier, are you ready to dive in?</h1>
      </div>
      <span class="pill ${open ? "good" : ""}">${open ? "Applications open" : "Applications closed"}</span>
    </header>

    <section class="grid two">
      <article class="panel">
        <h2>${hasSubmission ? "Your application" : "Start application"}</h2>
        <p>${hasSubmission ? "Latest submission is saved. You can view status or edit if cohort edit access is open." : cycle.upcoming_text}</p>
        <div class="actions">
          <a class="primary" href="/apply">${hasSubmission ? "Open form" : "Apply"}</a>
          <a class="secondary" href="/status">View status</a>
        </div>
      </article>
      <article class="panel">
        <h2>Approval status</h2>
        ${hasSubmission ? statusBlock(submission) : `<p>No application yet for ${escapeHtml(user.email)}.</p>`}
      </article>
    </section>

    ${cycle.state === "finalized" ? publicSummary(stats, split) : closedSummary(cycle, stats, split)}
  `;
}

function publicSummary(stats, split) {
  return `
    <section class="panel">
      <div class="section-head"><h2>Current cycle summary</h2><span class="muted">No names shown</span></div>
      <div class="metrics">
        <div><small>Total applicants</small><b>${Number(stats.total || 0)}</b></div>
        <div><small>Finalized</small><b>${Number(stats.finalized || 0)}</b></div>
        <div><small>Open admin tasks</small><b>${Number(stats.open_tasks || 0)}</b></div>
      </div>
      ${deptBars(split)}
    </section>`;
}

function closedSummary(cycle, stats, split) {
  if (cycle.application_open || cycle.edit_open) {
    return "";
  }
  return `
    <section class="panel">
      <div class="section-head"><h2>Applications closed</h2><span class="muted">${escapeHtml(cycle.upcoming_text)}</span></div>
      <div class="metrics">
        <div><small>Total applicants</small><b>${Number(stats.total || 0)}</b></div>
        <div><small>Manager pending</small><b>${Number(stats.manager_pending || 0)}</b></div>
        <div><small>Function pending</small><b>${Number(stats.function_pending || 0)}</b></div>
      </div>
      ${deptBars(split)}
    </section>`;
}

export function applicantForm({ user, cycle, submission, error = "" }) {
  const data = submission ? rowData(submission) : {};
  const canEdit = Boolean(cycle.application_open || (cycle.edit_open && submission));
  return `
    <header class="top">
      <div><p class="eyebrow">Application</p><h1>Multiplier application</h1></div>
      <span class="pill ${canEdit ? "good" : ""}">${canEdit ? "Editable" : "View only"}</span>
    </header>
    ${error ? `<div class="notice bad">${escapeHtml(error)}</div>` : ""}
    <section class="panel">
      <form method="post" action="/apply" class="form">
        ${lockedField("Name", "applicant_name", data.applicant_name || user.name)}
        ${lockedField("Email", "applicant_email", data.applicant_email || user.email)}
        ${field("Manager name", "manager_name", data.manager_name, "text", canEdit, true)}
        ${field("Manager email", "manager_email", data.manager_email, "email", canEdit, true)}
        ${selectField("Department", "department", data.department, DEPARTMENTS, canEdit, true)}
        ${selectField("Sub department", "sub_department", data.sub_department, SUB_DEPARTMENTS, canEdit, false)}
        ${textarea("Regular OKR", "regular_okr", data.regular_okr, canEdit, true)}
        ${textarea("Multiplier target", "multiplier_target", data.multiplier_target, canEdit, true)}
        ${textarea("Baseline", "baseline", data.baseline, canEdit, true)}
        ${textarea("AOP", "aop", data.aop, canEdit, Boolean(cycle.aop_required))}
        ${textarea("Team vision link", "team_vision", data.team_vision, canEdit, true)}
        ${textarea("Flywheel moved", "flywheel", data.flywheel, canEdit, true)}
        <label class="check full"><input type="checkbox" name="manager_aligned" ${data.manager_aligned ? "checked" : ""} ${canEdit ? "" : "disabled"} required><span>Manager is aligned</span></label>
        ${textarea("Support required from Multipliers team", "support_required", data.support_required, canEdit, false)}
        <div class="actions full">
          <button class="primary" ${canEdit ? "" : "disabled"}>Save application</button>
          <a class="secondary" href="/status">Status</a>
        </div>
      </form>
    </section>`;
}

export function applicantStatus({ submission, versions, tasks = [] }) {
  if (!submission) {
    return `<header class="top"><div><p class="eyebrow">Status</p><h1>No application yet</h1></div></header><a class="primary" href="/apply">Apply</a>`;
  }
  return `
    <header class="top"><div><p class="eyebrow">Status</p><h1>${escapeHtml(submission.applicant_name)}</h1></div>${statusPill(submission.status)}</header>
    <section class="grid two">
      <article class="panel"><h2>Current status</h2>${statusBlock(submission)}</article>
      <article class="panel"><h2>Latest details</h2>${compactDetails(rowData(submission))}</article>
    </section>
    ${tasks.length ? `<section class="panel"><div class="section-head"><h2>Requested changes</h2><span class="muted">Edit form, then resubmit</span></div>${taskList(tasks)}</section>` : ""}
    <section class="panel">
      <div class="section-head"><h2>Version history</h2><span class="muted">Latest: v${submission.version_no || 1}</span></div>
      ${versionList(versions, false)}
    </section>`;
}

export function adminDashboard({ cycle, stats, tasks, requests, snapshots, split }) {
  return `
    <header class="top">
      <div><p class="eyebrow">Admin cockpit</p><h1>${escapeHtml(cycle.name)} control room</h1></div>
      <div class="actions">
        <a class="secondary" href="/admin/export.xlsx">Export XLSX</a>
        <form method="post" action="/admin/finalize"><button class="primary">Finalize approved dataset</button></form>
      </div>
    </header>
    <section class="metrics">
      <div><small>Latest applicants</small><b>${Number(stats.total || 0)}</b><span>${Number(stats.versions || 0)} versions</span></div>
      <div><small>Manager pending</small><b>${Number(stats.manager_pending || 0)}</b><span>needs manager/recheck</span></div>
      <div><small>Function pending</small><b>${Number(stats.function_pending || 0)}</b><span>sent or queued</span></div>
      <div><small>Blockers</small><b>${Number(stats.blockers || 0)}</b><span>${Number(stats.open_tasks || 0)} open tasks</span></div>
    </section>
    <section class="grid two">
      <article class="panel">
        <div class="section-head"><h2>Cycle settings</h2><span class="muted">Timings configurable</span></div>
        ${settingsForm(cycle)}
      </article>
      <article class="panel">
        <div class="section-head"><h2>Department split</h2><span class="muted">Latest only</span></div>
        ${deptBars(split)}
      </article>
    </section>
    <section class="grid two">
      <article class="panel">
        <div class="section-head"><h2>Tasks</h2><a class="secondary small" href="/admin/tasks">Open</a></div>
        ${taskList(tasks)}
      </article>
      <article class="panel">
        <div class="section-head"><h2>Approval threads</h2><a class="secondary small" href="/admin/approvals">Open</a></div>
        ${requestList(requests)}
      </article>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Undo snapshots</h2><span class="muted">Manual checkpoint before big ops</span></div>
      <form class="inline" method="post" action="/admin/snapshot">
        <input name="label" placeholder="Snapshot label">
        <button class="secondary">Save snapshot</button>
      </form>
      ${snapshots.length ? `<ul class="plain">${snapshots.map((s) => `<li><b>${escapeHtml(s.label)}</b><span>${localStamp(s.created_at)} by ${escapeHtml(s.actor_email)}</span></li>`).join("")}</ul>` : `<p class="muted">No snapshots yet.</p>`}
    </section>
    <section class="panel">
      <div class="section-head"><h2>Next quarter</h2><span class="muted">Available after finalization</span></div>
      <form class="inline" method="post" action="/admin/new-quarter">
        <input name="name" placeholder="Next cycle name">
        <input name="quarter_label" placeholder="Quarter label">
        <button class="secondary">Start next quarter</button>
      </form>
    </section>`;
}

function settingsForm(cycle) {
  return `<form method="post" action="/admin/settings" class="form compact">
    ${field("Cycle name", "name", cycle.name, "text", true, true)}
    ${field("Quarter label", "quarter_label", cycle.quarter_label, "text", true, true)}
    ${field("Close at", "close_at", inputDateTime(cycle.close_at), "datetime-local", true, false)}
    ${field("Manager due hours", "manager_due_hours", cycle.manager_due_hours, "number", true, true)}
    ${field("Manager grace hours", "manager_reminder_hours", cycle.manager_reminder_hours, "number", true, true)}
    ${field("Function due hours", "function_due_hours", cycle.function_due_hours, "number", true, true)}
    ${field("Function grace hours", "function_reminder_hours", cycle.function_reminder_hours, "number", true, true)}
    ${field("Digest time", "daily_digest_time", cycle.daily_digest_time, "time", true, true)}
    ${field("Admin email", "admin_email", cycle.admin_email, "email", true, true)}
    ${field("Upcoming text", "upcoming_text", cycle.upcoming_text, "text", true, true)}
    <label class="check"><input type="checkbox" name="application_open" ${cycle.application_open ? "checked" : ""}><span>Application open</span></label>
    <label class="check"><input type="checkbox" name="edit_open" ${cycle.edit_open ? "checked" : ""}><span>Cohort edit access open</span></label>
    <label class="check"><input type="checkbox" name="aop_required" ${cycle.aop_required ? "checked" : ""}><span>AOP required</span></label>
    <label class="check"><input type="checkbox" name="allow_public_test_mode" ${cycle.allow_public_test_mode ? "checked" : ""}><span>Public test mode</span></label>
    <label>Cycle state<select name="state">
      ${option("applications_open", cycle.state, "Applications open")}
      ${option("manager_approval", cycle.state, "Manager approval")}
      ${option("function_approval", cycle.state, "Function approval")}
      ${option("finalized", cycle.state, "Finalized")}
    </select></label>
    <label>Manager rework mail<select name="manager_rework_send_mode">
      ${option("draft", cycle.manager_rework_send_mode, "Draft")}
      ${option("auto", cycle.manager_rework_send_mode, "Auto send")}
    </select></label>
    <label>Function rework mail<select name="function_rework_send_mode">
      ${option("draft", cycle.function_rework_send_mode, "Draft")}
      ${option("auto", cycle.function_rework_send_mode, "Auto send")}
    </select></label>
    <button class="primary full">Save settings</button>
  </form>`;
}

export function adminSubmissions({ rows, filters }) {
  return `
    <header class="top"><div><p class="eyebrow">Database</p><h1>Latest submissions</h1></div><a class="secondary" href="/admin/export.xlsx">Export XLSX</a></header>
    <section class="panel">
      <form class="filters" method="get" action="/admin/submissions">
        <input type="search" name="q" placeholder="Search name, email, manager, OKR" value="${escapeAttr(filters.q || "")}">
        <select name="department"><option value="">All departments</option>${DEPARTMENTS.map((d) => option(d, filters.department, d)).join("")}</select>
        <select name="status"><option value="">All statuses</option>${["pending", "approved", "recheck_needed", "rework", "rejected", "skipped", "finalized", "needs_admin_review"].map((s) => option(s, filters.status, s)).join("")}</select>
        <button class="secondary">Filter</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Team</th><th>Manager</th><th>Multiplier</th><th>Approval</th><th>Flags</th><th>Updated</th></tr></thead>
        <tbody>${rows.map(submissionRow).join("") || `<tr><td colspan="7">No rows.</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function submissionRow(row) {
  const data = rowData(row);
  const flags = safeJsonParse(row.objective_flags_json, []);
  return `<tr>
    <td><a href="/admin/submission/${row.id}"><b>${escapeHtml(row.applicant_name)}</b></a><br><span>${escapeHtml(row.applicant_email)}</span></td>
    <td>${escapeHtml(row.department)}<br><span>${escapeHtml(row.sub_department || "-")}</span></td>
    <td>${escapeHtml(row.manager_name)}<br><span>${escapeHtml(row.manager_email)}</span></td>
    <td>${escapeHtml(data.multiplier_target || "-")}</td>
    <td>${statusMini("Mgr", row.manager_status)}${statusMini("Func", row.function_status)}${statusMini("Final", row.final_status)}</td>
    <td>${flags.length ? flagLabels(flags).map((f) => `<span class="tag warn">${escapeHtml(f)}</span>`).join("") : `<span class="tag good">Clear</span>`}</td>
    <td>${localStamp(row.updated_at)}</td>
  </tr>`;
}

export function submissionDetail({ row, versions, audit }) {
  const data = rowData(row);
  return `
    <header class="top"><div><p class="eyebrow">Submission</p><h1>${escapeHtml(row.applicant_name)}</h1></div>${statusPill(row.status)}</header>
    <section class="grid two">
      <article class="panel"><h2>Latest version</h2>${compactDetails(data)}</article>
      <article class="panel"><h2>Admin edit</h2>${adminEditForm(row, data)}</article>
    </section>
    <section class="panel"><div class="section-head"><h2>Version history</h2><span class="muted">Restores create a new version</span></div>${versionList(versions, true)}</section>
    <section class="panel"><div class="section-head"><h2>Audit trail</h2><span class="muted">Undo window: 2h marker</span></div>${auditTrail(audit)}</section>`;
}

function adminEditForm(row, data) {
  return `<form method="post" action="/admin/submission/${row.id}/edit" class="form compact">
    ${field("Applicant name", "applicant_name", data.applicant_name, "text", true, true)}
    ${field("Applicant email", "applicant_email", data.applicant_email, "email", true, true)}
    ${field("Manager name", "manager_name", data.manager_name, "text", true, true)}
    ${field("Manager email", "manager_email", data.manager_email, "email", true, true)}
    ${selectField("Department", "department", data.department, DEPARTMENTS, true, true)}
    ${selectField("Sub department", "sub_department", data.sub_department, SUB_DEPARTMENTS, true, false)}
    ${textarea("Regular OKR", "regular_okr", data.regular_okr, true, true)}
    ${textarea("Multiplier target", "multiplier_target", data.multiplier_target, true, true)}
    ${textarea("Baseline", "baseline", data.baseline, true, true)}
    ${textarea("AOP", "aop", data.aop, true, true)}
    ${textarea("Team vision", "team_vision", data.team_vision, true, true)}
    ${textarea("Flywheel", "flywheel", data.flywheel, true, true)}
    <label class="check full"><input type="checkbox" name="manager_aligned" ${data.manager_aligned ? "checked" : ""}><span>Manager aligned</span></label>
    ${textarea("Support required", "support_required", data.support_required, true, false)}
    <button class="primary full">Save admin edit</button>
  </form>`;
}

export function adminApprovals({ requests }) {
  return `
    <header class="top"><div><p class="eyebrow">Approvals</p><h1>Manager and function threads</h1></div></header>
    <section class="grid three">
      <form class="panel action-panel" method="post" action="/admin/approvals/manager/prepare"><h2>Manager prep</h2><p>Create one grouped request per manager. Team 1 managers skipped.</p><button class="primary">Prepare manager drafts</button></form>
      <form class="panel action-panel" method="post" action="/admin/approvals/function/prepare"><h2>Function prep</h2><p>Allowed only when each applicant is manager approved, rejected with reason, or Team 1 skipped.</p><button class="primary">Prepare function drafts</button></form>
      <form class="panel action-panel" method="post" action="/admin/gmail/sync"><h2>Gmail sync</h2><p>Reads natural replies and auto-marks only clear approvals.</p><button class="secondary">Sync replies</button></form>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Threads</h2><span class="muted">Send test first, then live</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Stage</th><th>Reviewer</th><th>Status</th><th>Items</th><th>Due</th><th>Email</th></tr></thead>
        <tbody>${requests.map(requestRow).join("") || `<tr><td colspan="6">No approval requests yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function requestRow(row) {
  return `<tr>
    <td>${escapeHtml(row.stage)}</td>
    <td><a href="/review/${row.review_token}"><b>${escapeHtml(row.reviewer_name)}</b></a><br><span>${escapeHtml(row.reviewer_email)}</span></td>
    <td>${statusPill(row.status)}</td>
    <td>${Number(row.item_count || 0)} items<br><span>${Number(row.pending_count || 0)} pending</span></td>
    <td>${localStamp(row.due_at)}</td>
    <td>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/test"><input name="test_to" value="simar.kaler@gmail.com"><button class="secondary small">Send test</button></form>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/send"><button class="primary small">Send live</button></form>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/draft"><button class="secondary small">Create draft</button></form>
    </td>
  </tr>`;
}

export function reviewPage({ request, items, message = "" }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Multiplier review</title><style>${style()}</style></head>
<body><main class="review">
  <header class="top"><div><p class="eyebrow">${escapeHtml(request.stage)} review</p><h1>${escapeHtml(request.subject)}</h1><p class="muted">Reply naturally by email or use this page. Latest version is shown.</p></div>${statusPill(request.status)}</header>
  ${message ? `<div class="notice good">${escapeHtml(message)}</div>` : ""}
  ${items.map((item) => reviewItem(item, request.review_token)).join("")}
</main></body></html>`;
}

function reviewItem(item, token) {
  const data = rowData(item);
  const stale = item.version_id_at_send && item.version_id_at_send !== item.latest_version_id;
  return `<section class="panel review-item">
    <div class="section-head">
      <div><h2>${escapeHtml(item.applicant_name)}</h2><span class="muted">${escapeHtml(item.department)} / ${escapeHtml(item.sub_department || "-")} | v${item.version_no || 1}${stale ? `, email had v${item.sent_version_no || "old"}` : ""}</span></div>
      ${statusPill(item.status)}
    </div>
    ${stale ? `<div class="notice warn">Applicant edited after mail. Action here applies to latest version.</div>` : ""}
    ${compactDetails(data)}
    <form method="post" action="/review/${escapeAttr(token)}" class="review-actions">
      <input type="hidden" name="item_id" value="${item.id}">
      <textarea name="note" placeholder="Reason or requested change"></textarea>
      <button class="primary" name="action" value="approve">GTG</button>
      <button class="secondary" name="action" value="rework">Needs rework</button>
      <button class="danger" name="action" value="reject">Reject</button>
    </form>
  </section>`;
}

export function routesPage({ routes, team1 }) {
  return `
    <header class="top"><div><p class="eyebrow">Routes</p><h1>Function heads and Team 1</h1></div></header>
    <section class="panel">
      <form method="post" action="/admin/routes" class="route-table">
        <div class="table-wrap"><table><thead><tr><th>Department</th><th>Sub dept</th><th>Owner</th><th>Email</th></tr></thead>
        <tbody>${routes.map((r) => `<tr><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.sub_department || "-")}</td><td>${escapeHtml(r.owner_name)}</td><td><input name="route_${r.id}" value="${escapeAttr(r.owner_email || "")}" placeholder="owner@mosaicwellness.in"></td></tr>`).join("")}</tbody></table></div>
        <button class="primary">Save route emails</button>
      </form>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Team 1 managers</h2><span class="muted">Applicants under these managers skip manager mail</span></div>
      <div class="chips">${team1.map((m) => `<span class="tag">${escapeHtml(m.manager_name)}</span>`).join("")}</div>
    </section>`;
}

export function tasksPage({ tasks }) {
  return `<header class="top"><div><p class="eyebrow">Tasks</p><h1>Admin tasks</h1></div></header><section class="panel">${taskList(tasks, true)}</section>`;
}

export function auditPage({ events }) {
  return `<header class="top"><div><p class="eyebrow">Audit</p><h1>History</h1></div></header><section class="panel">${auditTrail(events)}</section>`;
}

function taskList(tasks, withDone = false) {
  if (!tasks.length) {
    return `<p class="muted">No tasks.</p>`;
  }
  return `<ul class="plain">${tasks.map((task) => `<li><b>${escapeHtml(task.title)}</b><span>${escapeHtml(task.details || "")}</span><em>${escapeHtml(task.priority)} | due ${localStamp(task.due_at)}</em>${withDone ? `<form method="post" action="/admin/tasks/${task.id}/done"><button class="secondary small">Done</button></form>` : ""}</li>`).join("")}</ul>`;
}

function requestList(requests) {
  if (!requests.length) {
    return `<p class="muted">No threads yet.</p>`;
  }
  return `<ul class="plain">${requests.slice(0, 8).map((req) => `<li><b>${escapeHtml(req.reviewer_name)} - ${escapeHtml(req.stage)}</b><span>${escapeHtml(req.status)} | ${Number(req.item_count || 0)} items</span></li>`).join("")}</ul>`;
}

function auditTrail(events) {
  if (!events.length) {
    return `<p class="muted">No audit events.</p>`;
  }
  return `<ul class="plain">${events.map((e) => `<li><b>${escapeHtml(e.action)}</b><span>${escapeHtml(e.actor_email)} on ${escapeHtml(e.entity_type)} #${e.entity_id}</span><em>${localStamp(e.created_at)}</em></li>`).join("")}</ul>`;
}

function versionList(versions, admin) {
  if (!versions.length) {
    return `<p class="muted">No versions.</p>`;
  }
  return `<ul class="versions">${versions.map((v) => `<li><b>v${v.version_no}</b><span>${escapeHtml(v.change_summary || "")}</span><em>${localStamp(v.created_at)} by ${escapeHtml(v.editor_email)}</em>${admin ? `<form method="post" action="/admin/submission/${v.submission_id}/restore"><input type="hidden" name="version_id" value="${v.id}"><button class="secondary small">Restore</button></form>` : ""}</li>`).join("")}</ul>`;
}

function compactDetails(data) {
  const fields = [
    ["Manager", `${data.manager_name || "-"} (${data.manager_email || "-"})`],
    ["Regular OKR", data.regular_okr],
    ["Multiplier target", data.multiplier_target],
    ["Baseline", data.baseline],
    ["AOP", data.aop],
    ["Team vision", data.team_vision],
    ["Flywheel", data.flywheel],
    ["Support", data.support_required],
  ];
  return `<dl class="details">${fields.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || "-")}</dd>`).join("")}</dl>`;
}

function statusBlock(row) {
  return `<div class="status-grid">
    <div><small>Manager</small>${statusPill(row.manager_status)}</div>
    <div><small>Function</small>${statusPill(row.function_status)}</div>
    <div><small>Final</small>${statusPill(row.final_status)}</div>
  </div>`;
}

function statusMini(label, status) {
  return `<span class="mini-status"><b>${label}</b>${escapeHtml(STATUS_LABELS[status] || status || "-")}</span>`;
}

function statusPill(status) {
  const value = STATUS_LABELS[status] || status || "-";
  const good = /approved|finalized|skipped|done|sent/i.test(value);
  const warn = /pending|review|rework|recheck|conflict|rejected|draft/i.test(value);
  return `<span class="pill ${good ? "good" : warn ? "warn" : ""}">${escapeHtml(value)}</span>`;
}

function deptBars(split) {
  const max = Math.max(1, ...split.map((row) => Number(row.count || 0)));
  if (!split.length) {
    return `<p class="muted">No applications yet.</p>`;
  }
  return `<div class="bars">${split.map((row) => `<div><span>${escapeHtml(row.department || "-")}</span><i style="--w:${(Number(row.count || 0) / max) * 100}%"></i><b>${Number(row.count || 0)}</b></div>`).join("")}</div>`;
}

function lockedField(label, name, value) {
  return `<label><span>${escapeHtml(label)}</span><input name="${name}" value="${escapeAttr(value)}" readonly></label>`;
}

function field(label, name, value, type, enabled, required) {
  return `<label><span>${escapeHtml(label)}${required ? " *" : ""}</span><input name="${name}" type="${type}" value="${escapeAttr(value || "")}" ${enabled ? "" : "readonly"} ${required ? "required" : ""}></label>`;
}

function textarea(label, name, value, enabled, required) {
  return `<label class="full"><span>${escapeHtml(label)}${required ? " *" : ""}</span><textarea name="${name}" ${enabled ? "" : "readonly"} ${required ? "required" : ""}>${escapeHtml(value || "")}</textarea></label>`;
}

function selectField(label, name, value, options, enabled, required) {
  return `<label><span>${escapeHtml(label)}${required ? " *" : ""}</span><select name="${name}" ${enabled ? "" : "disabled"} ${required ? "required" : ""}><option value="">Select</option>${options.map((item) => option(item, value, item)).join("")}</select></label>`;
}

function option(value, current, label) {
  return `<option value="${escapeAttr(value)}" ${String(value) === String(current) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function style() {
  return `
:root{--bg:#f5f7f2;--ink:#19231f;--muted:#65716b;--panel:#fff;--line:#dce3dc;--dark:#132821;--green:#16806f;--yellow:#f2c75d;--coral:#c95f4e;--blue:#24577a;--shadow:0 16px 40px rgba(22,33,27,.08);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#19231f;background:#f5f7f2}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eef6f1 0,#f5f7f2 330px);font-size:15px;line-height:1.45}a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit}button,.primary,.secondary,.danger{border-radius:7px;border:1px solid transparent;min-height:38px;padding:9px 13px;font-weight:750;cursor:pointer}.primary{background:var(--green);color:#fff;display:inline-flex;align-items:center;justify-content:center}.secondary{background:#fff;border-color:#bbc8bf;color:#21302a;display:inline-flex;align-items:center;justify-content:center}.danger{background:#ffe7e1;border-color:#efb5a8;color:#8d3328}.small{min-height:30px;padding:5px 9px;font-size:13px}input,select,textarea{width:100%;border:1px solid #b9c5be;border-radius:7px;background:#fff;color:var(--ink);padding:10px 11px}textarea{min-height:94px;resize:vertical}input:focus,select:focus,textarea:focus{outline:0;border-color:var(--green);box-shadow:0 0 0 3px rgba(22,128,111,.14)}.shell{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:100vh}.side{position:sticky;top:0;height:100vh;background:rgba(255,255,255,.9);border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:22px}.brand{display:flex;align-items:center;gap:11px}.brand b{display:block;font-size:18px}.brand small,.who small,.who span,.muted,td span,li span{color:var(--muted)}.mark{width:42px;height:42px;background:var(--dark);display:grid;grid-template-columns:repeat(2,1fr);gap:5px;padding:6px;border-radius:8px;box-shadow:var(--shadow)}.mark i{border-radius:3px;background:var(--yellow)}.mark i:nth-child(2){background:#6bb1a7}.mark i:nth-child(3){background:var(--coral)}.mark i:nth-child(4){background:#f8faf6}nav{display:grid;gap:7px}nav a{padding:10px 11px;border-radius:7px;font-weight:750;color:#41514a}nav a:hover{background:#edf3ef}nav a.active{background:var(--dark);color:#fff}.who{margin-top:auto;border:1px solid var(--line);border-radius:8px;padding:12px;background:#fbfcfa;display:grid;gap:2px;overflow:hidden}.who b,.who span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}main{min-width:0;padding:26px}.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:20px}.top h1{margin:0;font-size:30px;letter-spacing:0}.eyebrow{margin:0 0 4px;color:#6d7973;font-size:12px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.panel{background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:17px}.panel h2{font-size:18px;margin:0 0 12px}.panel p{color:var(--muted);margin:0 0 14px}.grid{display:grid;gap:18px;margin-bottom:18px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:repeat(3,minmax(0,1fr))}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.metrics>div{background:#fff;border:1px solid var(--line);border-radius:8px;padding:15px;box-shadow:var(--shadow);display:grid;gap:3px}.metrics small{color:var(--muted);font-weight:850;text-transform:uppercase;font-size:12px;letter-spacing:.06em}.metrics b{font-size:32px;line-height:1}.metrics span{color:var(--muted)}.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:13px}.actions{display:flex;gap:9px;flex-wrap:wrap}.form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.form.compact textarea{min-height:70px}.full{grid-column:1/-1}.check{display:flex;align-items:center;gap:9px}.check input{width:18px;height:18px;accent-color:var(--green)}.filters,.inline{display:grid;grid-template-columns:minmax(220px,1fr) 190px 170px auto;gap:10px;margin-bottom:13px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;background:#fff;min-width:900px}th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#162b24;color:#fff;font-size:12px;letter-spacing:.05em;text-transform:uppercase}tr:hover td{background:#f8fbf8}.pill,.tag{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:850;background:#eef3ef;color:#34443d;margin:2px}.pill.good,.tag.good{background:#e6f4ee;color:#146045}.pill.warn,.tag.warn{background:#fff1d4;color:#7a4e0e}.notice{border:1px solid #ecc063;border-radius:8px;background:#fff1d4;color:#69440f;padding:11px 12px;margin:0 0 14px;font-weight:700}.notice.bad{background:#ffe7e1;border-color:#e9a696;color:#863125}.notice.good{background:#e6f4ee;border-color:#aad6c3;color:#145d43}.details{display:grid;grid-template-columns:140px minmax(0,1fr);gap:8px 12px;margin:0}.details dt{font-weight:850;color:#4d5c55}.details dd{margin:0;color:#23302b}.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.status-grid div{border:1px solid var(--line);border-radius:8px;padding:12px}.status-grid small{display:block;color:var(--muted);font-weight:850;margin-bottom:5px}.mini-status{display:grid;gap:2px;margin-bottom:6px}.mini-status b{font-size:12px;color:#56645d}.plain,.versions{list-style:none;margin:0;padding:0;display:grid;gap:9px}.plain li,.versions li{border-bottom:1px solid var(--line);padding:0 0 9px;display:grid;gap:2px}.plain li:last-child,.versions li:last-child{border-bottom:0}.plain em,.versions em{color:#7a867f;font-style:normal;font-size:13px}.bars{display:grid;gap:9px}.bars div{display:grid;grid-template-columns:145px minmax(0,1fr) 32px;gap:9px;align-items:center}.bars i{height:10px;border-radius:999px;background:linear-gradient(90deg,var(--green),#6bb1a7);width:var(--w);min-width:3px}.mini{display:grid;grid-template-columns:minmax(170px,1fr) auto;gap:6px;margin-bottom:6px}.mini button{white-space:nowrap}.route-table{display:grid;gap:12px}.chips{display:flex;flex-wrap:wrap;gap:7px}.review{max-width:1100px;margin:0 auto;padding:26px}.review-item{margin-bottom:16px}.review-actions{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:9px;margin-top:13px}.review-actions textarea{min-height:54px}button:disabled{opacity:.5;cursor:not-allowed}@media(max-width:980px){.shell{grid-template-columns:1fr}.side{position:static;height:auto}.two,.three,.metrics,.form,.filters,.inline,.review-actions{grid-template-columns:1fr}main,.review{padding:16px}.top{flex-direction:column}.details{grid-template-columns:1fr}.bars div{grid-template-columns:110px minmax(0,1fr) 28px}}`;
}
