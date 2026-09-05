import { DEFAULT_FUNCTION_SUB_FUNCTIONS, DEFAULT_FUNCTIONS, DEFAULT_SUB_FUNCTIONS, STATUS_LABELS } from "./constants.js";
import { MULTIPLIERS_LOGO_DATA_URI } from "./logo.js";
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
<body class="${admin ? "admin-mode" : "applicant-mode"}">
  <div class="shell">
    <aside class="side">
      <a class="brand" href="${admin ? "/admin" : "/"}">
        <span class="logo-tile"><img src="${MULTIPLIERS_LOGO_DATA_URI}" alt="Multipliers"></span>
        <span class="brand-copy"><b>Multipliers OS</b><small>${escapeHtml(cycle.name)}</small></span>
      </a>
      <nav>
        ${nav.map(([href, label, key]) => `<a class="${active === key ? "active" : ""}" href="${href}"><span>${label}</span></a>`).join("")}
      </nav>
      ${user.canUseTestProfiles ? `<div class="role-switch">${user.isTestUser ? testProfileControls(admin) : testLoginLinks(admin)}</div>` : ""}
      <div class="cycle-card">
        <small>Cycle mode</small>
        <b>${escapeHtml(cycleStateLabel(cycle.state))}</b>
        <span>${cycle.application_open ? "Applications open" : cycle.edit_open ? "Edit access open" : "Applications closed"}</span>
      </div>
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
  <script>${clientScript()}</script>
</body>
</html>`;
}

function testProfileControls(admin) {
  return `<div class="test-switch">
    <form method="post" action="/test-profile">
      <input type="hidden" name="profile" value="${admin ? "applicant" : "admin"}">
      <button class="side-button">${admin ? "View user side" : "View admin cockpit"}</button>
    </form>
    <form method="post" action="/test-logout"><button class="side-button quiet">Change test login</button></form>
  </div>`;
}

function testLoginLinks(admin) {
  return `<div class="test-switch">
    <a class="side-button" href="/test-login?profile=${admin ? "applicant" : "admin"}&next=${admin ? "%2F" : "%2Fadmin"}">${admin ? "Preview user side" : "Preview admin cockpit"}</a>
  </div>`;
}

export function applicantHome({ user, cycle, submission, stats, split }) {
  const hasSubmission = Boolean(submission);
  const open = cycle.application_open || cycle.edit_open;
  const actionLabel = hasSubmission ? (cycle.edit_open ? "Edit application" : "View application") : "Start application";
  const actionHref = "/apply";
  return `
    <section class="applicant-hero">
      <div class="hero-art" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="hero-copy">
        <p class="eyebrow">Multiplier cycle</p>
        <h1>Hello potential multiplier, are you ready to dive in?</h1>
        <p>${hasSubmission ? "Your application is saved. You can come back here to see status, requested changes, and the latest version." : open ? "Capture the target that can move the business, the baseline you are starting from, and the support you need to make it real." : escapeHtml(cycle.upcoming_text)}</p>
        <div class="actions">
          <a class="primary hero-cta" href="${actionHref}">${escapeHtml(actionLabel)}</a>
          ${hasSubmission ? `<a class="secondary" href="/status">Approval status</a>` : ""}
        </div>
      </div>
      <div class="hero-ticket">
        <small>${open ? "Applications open" : "Applications closed"}</small>
        <b>${escapeHtml(cycle.quarter_label || cycle.name)}</b>
        <span>${hasSubmission ? `Latest version v${submission.version_no || 1}` : "Not submitted yet"}</span>
      </div>
    </section>

    <section class="experience-path">
      ${experienceStep("1", "Choose your lane", hasSubmission ? "Function and manager are saved." : "Pick your function and sub-function.")}
      ${experienceStep("2", "Shape the target", "Regular OKR, baseline, AOP, and multiplier target.")}
      ${experienceStep("3", "Get aligned", hasSubmission ? "Track manager and function approvals." : "Confirm manager alignment before you submit.")}
    </section>

    <section class="grid two">
      <article class="panel applicant-panel">
        <div class="section-head">
          <h2>${hasSubmission ? "Your approval journey" : "Your next move"}</h2>
          ${hasSubmission ? statusPill(submission.status) : `<span class="pill">Fresh start</span>`}
        </div>
        ${hasSubmission ? applicantJourney(submission) : emptyState(open ? "Start the application when you are ready." : "Applications are closed right now.")}
      </article>
      <article class="panel applicant-panel">
        <div class="section-head"><h2>${hasSubmission ? "Saved options" : "Cycle snapshot"}</h2><span class="muted">${escapeHtml(user.email)}</span></div>
        ${hasSubmission ? applicantHomeActions(cycle, submission) : cycleSnapshot(stats, split)}
      </article>
    </section>

    ${cycle.state === "finalized" ? publicSummary(stats, split) : closedSummary(cycle, stats, split)}
  `;
}

function experienceStep(number, title, detail) {
  return `<article>
    <span>${escapeHtml(number)}</span>
    <b>${escapeHtml(title)}</b>
    <small>${escapeHtml(detail)}</small>
  </article>`;
}

function applicantHomeActions(cycle, submission) {
  return `<div class="home-actions">
    <a class="primary" href="/apply">${cycle.edit_open ? "Edit latest version" : "View latest version"}</a>
    <a class="secondary" href="/status">See approval status</a>
    ${submission.status === "needs_admin_review" || submission.manager_status === "rework" || submission.function_status === "rework" ? `<a class="secondary" href="/status">Requested changes</a>` : ""}
  </div>`;
}

function cycleSnapshot(stats, split) {
  return `<div class="snapshot">
    <div><small>Total applicants</small><b>${Number(stats.total || 0)}</b></div>
    <div><small>Functions active</small><b>${Number(split?.length || 0)}</b></div>
  </div>`;
}

function publicSummary(stats, split) {
  return `
    <section class="panel">
      <div class="section-head"><h2>Current cycle summary</h2><span class="muted">No names shown</span></div>
      <div class="metrics three">
        ${metricCard("Total applicants", stats.total, "latest submission per email", "blue")}
        ${metricCard("Finalized", stats.finalized, `${percent(stats.finalized, stats.total)} of applicant pool`, "green")}
        ${metricCard("Open admin tasks", stats.open_tasks, "visible to admins", Number(stats.open_tasks || 0) ? "amber" : "green")}
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
      <div class="metrics three">
        ${metricCard("Total applicants", stats.total, "latest submission per email", "blue")}
        ${metricCard("Manager pending", stats.manager_pending, "approval or recheck", Number(stats.manager_pending || 0) ? "amber" : "green")}
        ${metricCard("Function pending", stats.function_pending, "after manager closure", Number(stats.function_pending || 0) ? "amber" : "green")}
      </div>
      ${deptBars(split)}
    </section>`;
}

export function applicantForm({ user, cycle, submission, routes = [], error = "" }) {
  const data = submission ? rowData(submission) : {};
  const canEdit = Boolean(cycle.application_open || (cycle.edit_open && submission));
  const routeOptions = buildRouteOptions(routes, data);
  return `
    <header class="top form-top">
      <div>
        <p class="eyebrow">Application</p>
        <h1>Build your multiplier case</h1>
        <p class="top-note">One page, four calm sections. Your latest saved version is what approvals will use.</p>
      </div>
      <span class="pill ${canEdit ? "good" : "warn"}">${canEdit ? "Editable" : "View only"}</span>
    </header>
    ${error ? `<div class="notice bad">${escapeHtml(error)}</div>` : ""}
    <nav class="form-steps" aria-label="Application sections">
      <a href="#you">You</a>
      <a href="#team">Team</a>
      <a href="#goal">Goal</a>
      <a href="#alignment">Alignment</a>
    </nav>
    <section class="form-layout">
      <aside class="form-aside">
        <div>
          <small>Signed in as</small>
          <b>${escapeHtml(data.applicant_name || user.name)}</b>
          <span>${escapeHtml(data.applicant_email || user.email)}</span>
        </div>
        <div>
          <small>Cycle</small>
          <b>${escapeHtml(cycle.quarter_label || cycle.name)}</b>
          <span>${canEdit ? "Form is open" : "Form is locked"}</span>
        </div>
        ${submission ? `<div>${statusBlock(submission)}</div>` : ""}
      </aside>
      <form method="post" action="/apply" class="panel form application-form">
        <div class="form-chapter full" id="you">
          <span>1</span>
          <div><h2>You</h2><p>Name and email are locked from login so versions stay clean.</p></div>
        </div>
        ${lockedField("Name", "applicant_name", data.applicant_name || user.name)}
        ${lockedField("Email", "applicant_email", data.applicant_email || user.email)}

        <div class="form-chapter full" id="team">
          <span>2</span>
          <div><h2>Team</h2><p>This decides the approval path and function-head grouping.</p></div>
        </div>
        ${selectField("Function", "department", data.department, routeOptions.functions, canEdit, true, "Choose the closest business/function home for this multiplier.")}
        ${selectField("Sub-function", "sub_department", data.sub_department, routeOptions.subFunctions, canEdit, false, "Pick one only if it applies. The list changes after function selection.")}
        ${field("Manager name", "manager_name", data.manager_name, "text", canEdit, true, "Use the name your manager would recognize in the approval mail.")}
        ${field("Manager email", "manager_email", data.manager_email, "email", canEdit, true, "This is where manager approval will be requested.")}

        <div class="form-chapter full" id="goal">
          <span>3</span>
          <div><h2>Multiplier goal</h2><p>Be concrete. Numbers, dates, SKU, channel, platform, and scope make approvals smoother.</p></div>
        </div>
        ${textarea("What is your regular OKR?", "regular_okr", data.regular_okr, canEdit, true, "Write the regular OKR this multiplier will sit beside. Add SKU, channel, or platform if relevant.")}
        ${textarea("What is your Multiplier target?", "multiplier_target", data.multiplier_target, canEdit, true, "State the multiplier target with the metric, start point, target number, and timeline.")}
        ${textarea("What is the baseline for your Multiplier?", "baseline", data.baseline, canEdit, true, "Add the current run rate or starting point. If the baseline is zero, say zero and explain why.")}
        ${textarea("What is the AOP?", "aop", data.aop, canEdit, Boolean(cycle.aop_required), "Add the AOP number if this applies to your team.")}
        ${textarea("How is it in line with your team's vision?", "team_vision", data.team_vision, canEdit, true, "Connect this target to the team's focus for the quarter. Keep it specific.")}
        ${textarea("What part of the flywheel are you moving?", "flywheel", data.flywheel, canEdit, true, "Examples: acquisition, conversion, retention, revenue, operations speed, quality, or cost efficiency.")}

        <div class="form-chapter full" id="alignment">
          <span>4</span>
          <div><h2>Alignment</h2><p>Confirm manager alignment and call out only the support that needs Multipliers intervention.</p></div>
        </div>
        <label class="check full alignment-check"><input type="checkbox" name="manager_aligned" ${data.manager_aligned ? "checked" : ""} ${canEdit ? "" : "disabled"} required><span>Is your manager in line with this?</span><small>Tick this only if your manager is aligned with the multiplier target.</small></label>
        ${textarea("What support would you require from Multipliers team?", "support_required", data.support_required, canEdit, false, "Do not list normal dependencies. Mention only specific unblockers where the Multipliers team can help.")}
        <script type="application/json" id="route-options">${jsonScript(routeOptions.byFunction)}</script>
        <div class="actions full form-actions">
          <button class="primary" ${canEdit ? "" : "disabled"}>${submission ? "Save latest version" : "Submit application"}</button>
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
    <header class="top"><div><p class="eyebrow">Status</p><h1>${escapeHtml(submission.applicant_name)}</h1></div><div class="actions">${statusPill(submission.status)}<a class="secondary" href="/apply">Open form</a></div></header>
    <section class="panel journey-panel">${applicantJourney(submission)}</section>
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

export function adminDashboard({ cycle, stats, tasks, requests, snapshots, split, gmail }) {
  return `
    <header class="top ops-top">
      <div>
        <p class="eyebrow">Admin cockpit</p>
        <h1>${escapeHtml(cycleStateLabel(cycle.state))}</h1>
        <p class="top-note">${escapeHtml(cycle.name)} · ${Number(stats.total || 0)} latest applicants · ${Number(stats.versions || 0)} saved versions</p>
      </div>
      <div class="actions">
        <a class="secondary" href="/admin/export.xlsx">Export XLSX</a>
        <form method="post" action="/admin/finalize"><button class="primary">Finalize approved dataset</button></form>
      </div>
    </header>
    <section class="ops-strip">
      <article class="ops-card priority-card">
        <div class="section-head"><h2>Needs attention</h2>${attentionPill(stats, tasks, gmail)}</div>
        ${attentionList(stats, tasks, gmail)}
      </article>
      <article class="ops-card">
        <div class="section-head"><h2>Cycle totals</h2><span class="pill ${cycle.application_open ? "good" : cycle.edit_open ? "warn" : ""}">${cycle.application_open ? "Open" : cycle.edit_open ? "Edits open" : "Closed"}</span></div>
        ${opsTotals(stats)}
      </article>
    </section>
    ${stageBoard(cycle, stats)}
    <section class="grid two admin-work-grid">
      <article class="panel">
        <div class="section-head"><h2>Tasks</h2><a class="secondary small" href="/admin/tasks">Open all</a></div>
        ${taskList(tasks)}
      </article>
      <article class="panel">
        <div class="section-head"><h2>Gmail</h2>${gmailPill(gmail)}</div>
        ${gmailPanel(gmail)}
      </article>
      <article class="panel">
        <div class="section-head"><h2>Department split</h2><span class="muted">Latest only</span></div>
        ${deptBars(split)}
      </article>
      <article class="panel">
        <div class="section-head"><h2>Approval threads</h2><a class="secondary small" href="/admin/approvals">Open all</a></div>
        ${requestList(requests)}
      </article>
    </section>
    <section class="utility-stack">
      <details class="utility">
        <summary><span>Cycle settings</span><small>Open/close, timings, digest, rework mode</small></summary>
        ${settingsForm(cycle)}
      </details>
      <details class="utility">
        <summary><span>Snapshots</span><small>${Number(snapshots.length || 0)} saved</small></summary>
        <form class="inline" method="post" action="/admin/snapshot">
          <input name="label" placeholder="Snapshot label">
          <button class="secondary">Save snapshot</button>
        </form>
        ${snapshots.length ? `<ul class="plain">${snapshots.map((s) => `<li><b>${escapeHtml(s.label)}</b><span>${localStamp(s.created_at)} by ${escapeHtml(s.actor_email)}</span></li>`).join("")}</ul>` : `<p class="muted">No snapshots yet.</p>`}
      </details>
      <details class="utility">
        <summary><span>Next quarter</span><small>Available after finalization</small></summary>
        <form class="inline" method="post" action="/admin/new-quarter">
          <input name="name" placeholder="Next cycle name">
          <input name="quarter_label" placeholder="Quarter label">
          <button class="secondary">Start next quarter</button>
        </form>
      </details>
    </section>`;
}

function metricCard(label, value, context, tone = "blue") {
  return `<div class="metric-card ${escapeAttr(tone)}"><small>${escapeHtml(label)}</small><b>${Number(value || 0)}</b><span>${escapeHtml(context || "")}</span></div>`;
}

function attentionPill(stats, tasks, gmail) {
  const count = attentionItems(stats, tasks, gmail).length;
  return count ? `<span class="pill bad">${count} open</span>` : `<span class="pill good">Clear</span>`;
}

function attentionList(stats, tasks, gmail) {
  const items = attentionItems(stats, tasks, gmail);
  if (!items.length) {
    return `<div class="empty tight"><b>No admin action right now</b><span>Current workflow is clear.</span></div>`;
  }
  return `<ul class="attention-list">${items.slice(0, 5).map((item) => `<li class="${escapeAttr(item.tone)}">
    <span class="signal"></span>
    <div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.detail || "")}</small></div>
    <a class="secondary small" href="${escapeAttr(item.href)}">${escapeHtml(item.action)}</a>
  </li>`).join("")}</ul>`;
}

function attentionItems(stats, tasks, gmail) {
  const items = [];
  if (!gmail?.configured && !gmail?.localPreview) {
    const missing = gmail?.missing?.length ? `${gmail.missing.length} OAuth secrets missing` : "OAuth secrets missing";
    items.push({ tone: "bad", title: "Gmail not connected", detail: missing, href: "/admin/approvals", action: "Open" });
  }
  if (Number(stats.blockers || 0)) {
    items.push({ tone: "bad", title: `${Number(stats.blockers || 0)} application blockers`, detail: "Objective checks or admin review flags", href: "/admin/submissions?status=needs_admin_review", action: "Review" });
  }
  if (Number(stats.manager_pending || 0)) {
    items.push({ tone: "warn", title: `${Number(stats.manager_pending || 0)} manager approvals pending`, detail: "Manager approval or recheck", href: "/admin/approvals", action: "Open" });
  }
  if (Number(stats.function_pending || 0)) {
    items.push({ tone: "warn", title: `${Number(stats.function_pending || 0)} function approvals pending`, detail: "Function head queue", href: "/admin/approvals", action: "Open" });
  }
  const visibleTasks = (tasks || []).filter((task) => gmail?.configured || task.kind !== "gmail_setup");
  for (const task of visibleTasks.slice(0, 3)) {
    items.push({ tone: task.priority === "blocker" ? "bad" : task.priority === "high" ? "warn" : "", title: task.title, detail: task.details || task.priority, href: "/admin/tasks", action: "Task" });
  }
  return items;
}

function opsTotals(stats) {
  return `<div class="ops-numbers">
    ${opsNumber("Applicants", stats.total, "latest")}
    ${opsNumber("Manager", stats.manager_pending, "pending")}
    ${opsNumber("Function", stats.function_pending, "pending")}
    ${opsNumber("Final", stats.finalized, "finalized")}
  </div>`;
}

function opsNumber(label, value, detail) {
  return `<div><small>${escapeHtml(label)}</small><b>${Number(value || 0)}</b><span>${escapeHtml(detail)}</span></div>`;
}

function stageBoard(cycle, stats) {
  const total = Number(stats.total || 0);
  const managerPending = Number(stats.manager_pending || 0);
  const functionPending = Number(stats.function_pending || 0);
  const finalized = Number(stats.finalized || 0);
  const managerClosed = Math.max(0, total - managerPending);
  const functionClosed = Math.max(0, total - functionPending);
  return `<section class="stage-board">
    ${stageCard({
      label: "Collect",
      value: total,
      detail: `${Number(stats.versions || 0)} versions`,
      state: cycle.application_open || cycle.edit_open ? "current" : total ? "done" : "",
      href: "/admin/submissions",
      action: "Database",
    })}
    ${stageCard({
      label: "Manager",
      value: managerPending,
      detail: `${percent(managerClosed, total)} closed`,
      state: managerPending ? "current" : total ? "done" : "",
      href: "/admin/approvals",
      action: "Approvals",
    })}
    ${stageCard({
      label: "Function",
      value: functionPending,
      detail: `${percent(functionClosed, total)} closed`,
      state: functionPending ? "current" : finalized ? "done" : "",
      href: "/admin/approvals",
      action: "Approvals",
    })}
    ${stageCard({
      label: "Finalize",
      value: finalized,
      detail: `${percent(finalized, total)} finalized`,
      state: finalized && finalized === total ? "done" : cycle.state === "finalized" ? "done" : "",
      post: "/admin/finalize",
      action: "Finalize",
    })}
  </section>`;
}

function stageCard({ label, value, detail, state = "", href = "", post = "", action }) {
  const control = post
    ? `<form method="post" action="${escapeAttr(post)}"><button class="secondary small">${escapeHtml(action)}</button></form>`
    : `<a class="secondary small" href="${escapeAttr(href)}">${escapeHtml(action)}</a>`;
  return `<article class="stage-card ${escapeAttr(state)}">
    <span class="stage-line"></span>
    <small>${escapeHtml(label)}</small>
    <b>${Number(value || 0)}</b>
    <em>${escapeHtml(detail || "")}</em>
    ${control}
  </article>`;
}

function gmailPill(gmail) {
  if (gmail?.configured) {
    return `<span class="pill good">Connected</span>`;
  }
  if (gmail?.localPreview) {
    return `<span class="pill warn">Local preview</span>`;
  }
  return `<span class="pill bad">OAuth missing</span>`;
}

function gmailPanel(gmail) {
  if (gmail?.configured) {
    return `<div class="gmail-panel connected">
      <b>Gmail actions are ready.</b>
      <span>Sender: ${escapeHtml(gmail.sender || "-")}</span>
    </div>`;
  }
  if (gmail?.localPreview) {
    return `<div class="gmail-panel local">
      <b>Email is paused in local preview.</b>
      <span>Production Gmail secrets live in GitHub/Cloudflare, so the deployed app can send, draft, and sync. Local preview stays disabled unless private dev secrets are added.</span>
    </div>`;
  }
  const missing = gmail?.missing?.length ? gmail.missing : ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
  return `<div class="gmail-panel">
    <b>Sending, drafts, and reply sync are paused.</b>
    <span>Add these GitHub secrets, then push or rerun deploy:</span>
    <div class="chips">${missing.map((name) => `<span class="tag bad">${escapeHtml(name)}</span>`).join("")}</div>
  </div>`;
}

function workflowProgress(stats) {
  const total = Number(stats.total || 0);
  const managerPending = Number(stats.manager_pending || 0);
  const functionPending = Number(stats.function_pending || 0);
  const finalized = Number(stats.finalized || 0);
  const managerClosed = Math.max(0, total - managerPending);
  const functionClosed = Math.max(0, total - functionPending);
  return `<div class="workflow-progress">
    ${progressStep("Collect", total, total ? "done" : "current", "latest applicants")}
    ${progressStep("Manager", managerClosed, managerPending ? "current" : total ? "done" : "", `${percent(managerClosed, total)} closed`)}
    ${progressStep("Function", functionClosed, functionPending ? "current" : finalized ? "done" : "", `${percent(functionClosed, total)} closed`)}
    ${progressStep("Finalize", finalized, finalized && finalized === total ? "done" : "", `${percent(finalized, total)} finalized`)}
  </div>`;
}

function progressStep(label, value, state, context) {
  return `<div class="progress-step ${escapeAttr(state)}"><span></span><b>${escapeHtml(label)}</b><em>${Number(value || 0)}</em><small>${escapeHtml(context)}</small></div>`;
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
        <input type="search" name="department" placeholder="Department" value="${escapeAttr(filters.department || "")}">
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
    ${field("Department", "department", data.department, "text", true, true)}
    ${field("Sub department", "sub_department", data.sub_department, "text", true, false)}
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

export function adminApprovals({ requests, gmail, notice = "", noticeTone = "" }) {
  return `
    <header class="top"><div><p class="eyebrow">Approvals</p><h1>Manager and function threads</h1></div></header>
    ${notice ? `<div class="notice ${escapeAttr(noticeTone)}">${escapeHtml(notice)}</div>` : ""}
    <section class="panel gmail-readiness">
      <div class="section-head"><h2>Gmail readiness</h2>${gmailPill(gmail)}</div>
      ${gmailPanel(gmail)}
    </section>
    <section class="grid three">
      <form class="panel action-panel" method="post" action="/admin/approvals/manager/prepare"><h2>Manager prep</h2><p>Create one grouped request per manager. Team 1 managers skipped.</p><button class="primary">Prepare manager drafts</button></form>
      <form class="panel action-panel" method="post" action="/admin/approvals/function/prepare"><h2>Function prep</h2><p>Allowed only when each applicant is manager approved, rejected with reason, or Team 1 skipped.</p><button class="primary">Prepare function drafts</button></form>
      <form class="panel action-panel" method="post" action="/admin/gmail/sync"><h2>Gmail sync</h2><p>Reads natural replies and auto-marks only clear approvals.</p><button class="secondary" ${gmail?.configured ? "" : "disabled"}>Sync replies</button></form>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Threads</h2><span class="muted">Send test first, then live</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Stage</th><th>Reviewer</th><th>Status</th><th>Items</th><th>Due</th><th>Email</th></tr></thead>
        <tbody>${requests.map((row) => requestRow(row, gmail)).join("") || `<tr><td colspan="6">No approval requests yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function requestRow(row, gmail) {
  const disabled = gmail?.configured ? "" : "disabled";
  return `<tr>
    <td>${escapeHtml(row.stage)}</td>
    <td><a href="/review/${row.review_token}"><b>${escapeHtml(row.reviewer_name)}</b></a><br><span>${escapeHtml(row.reviewer_email)}</span></td>
    <td>${statusPill(row.status)}</td>
    <td>${Number(row.item_count || 0)} items<br><span>${Number(row.pending_count || 0)} pending</span></td>
    <td>${localStamp(row.due_at)}</td>
    <td>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/test"><input name="test_to" placeholder="test@example.com" ${disabled}><button class="secondary small" ${disabled}>Send test</button></form>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/send"><button class="primary small" ${disabled}>Send live</button></form>
      <form class="mini" method="post" action="/admin/approvals/${row.id}/draft"><button class="secondary small" ${disabled}>Create draft</button></form>
    </td>
  </tr>`;
}

export function reviewPage({ request, items, message = "" }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Multiplier review</title><style>${style()}</style></head>
<body class="review-mode"><main class="review">
  <section class="review-hero">
    <div>
      <p class="eyebrow">${escapeHtml(request.stage)} review</p>
      <h1>${escapeHtml(request.subject)}</h1>
      <p>Reply by email or review here. This page always shows the latest submitted version.</p>
    </div>
    <div class="review-count">
      <b>${Number(items.length || 0)}</b>
      <span>items</span>
      ${statusPill(request.status)}
    </div>
  </section>
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
    <header class="top"><div><p class="eyebrow">Routes</p><h1>Function dropdowns and approvers</h1><p class="top-note">These rows power the applicant function/sub-function dropdowns and later route function-head emails.</p></div></header>
    <section class="panel">
      <form method="post" action="/admin/routes" class="route-table">
        <div class="section-head"><h2>Function routes</h2><span class="muted">Turn off a row to remove it from applicant dropdowns</span></div>
        <div class="table-wrap"><table><thead><tr><th>Function</th><th>Sub-function</th><th>Function head</th><th>Email</th><th>Shown</th></tr></thead>
        <tbody>${routes.map((r) => `<tr>
          <td><input name="route_department_${r.id}" value="${escapeAttr(r.department)}" required></td>
          <td><input name="route_sub_department_${r.id}" value="${escapeAttr(r.sub_department || "")}" placeholder="Optional"></td>
          <td><input name="route_owner_name_${r.id}" value="${escapeAttr(r.owner_name)}" required></td>
          <td><input name="route_owner_email_${r.id}" value="${escapeAttr(r.owner_email || "")}" placeholder="owner@example.com"></td>
          <td><label class="check"><input type="checkbox" name="route_active_${r.id}" ${r.active ? "checked" : ""}><span>Yes</span></label></td>
        </tr>`).join("") || `<tr><td colspan="5">No routes yet.</td></tr>`}</tbody></table></div>
        <button class="primary">Save routes</button>
      </form>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Add dropdown option</h2><span class="muted">Also becomes an approval route once function-head email is filled</span></div>
      <form method="post" action="/admin/routes/add" class="form compact">
        ${field("Function", "department", "", "text", true, true)}
        ${field("Sub-function", "sub_department", "", "text", true, false)}
        ${field("Function head", "owner_name", "", "text", true, true)}
        ${field("Function-head email", "owner_email", "", "email", true, false)}
        <button class="primary full">Add route</button>
      </form>
    </section>
    <section class="panel">
      <div class="section-head"><h2>Team 1 managers</h2><span class="muted">Applicants under these managers skip manager mail</span></div>
      <div class="chips">${team1.map((m) => `<span class="tag">${escapeHtml(m.manager_name)}${m.manager_email ? ` - ${escapeHtml(m.manager_email)}` : ""}</span>`).join("") || `<span class="muted">No Team 1 managers yet.</span>`}</div>
      <form method="post" action="/admin/team1/add" class="inline route-add">
        <input name="manager_name" placeholder="Manager name" required>
        <input name="manager_email" placeholder="manager@example.com">
        <button class="secondary">Add Team 1 manager</button>
      </form>
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

function applicantJourney(row) {
  return `<div class="journey">
    ${journeyStep("Application", row.status === "submitted" || row.latest_version_id, "Latest version saved", row.version_no ? `v${row.version_no}` : "")}
    ${journeyStep("Manager", isClosedStatus(row.manager_status), STATUS_LABELS[row.manager_status] || row.manager_status || "Pending", statusTone(row.manager_status))}
    ${journeyStep("Function", isClosedStatus(row.function_status), STATUS_LABELS[row.function_status] || row.function_status || "Not ready", statusTone(row.function_status))}
    ${journeyStep("Final", row.final_status === "finalized", STATUS_LABELS[row.final_status] || row.final_status || "Pending", statusTone(row.final_status))}
  </div>`;
}

function journeyStep(label, complete, detail, tone = "") {
  return `<div class="journey-step ${complete ? "done" : ""} ${escapeAttr(tone)}"><span></span><b>${escapeHtml(label)}</b><small>${escapeHtml(detail || "-")}</small></div>`;
}

function isClosedStatus(status) {
  return ["approved", "rejected", "skipped", "finalized"].includes(status);
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
  const tone = statusTone(status || value);
  return `<span class="pill ${tone}">${escapeHtml(value)}</span>`;
}

function statusTone(status) {
  const value = String(status || "");
  if (/approved|finalized|skipped|done|sent/i.test(value)) {
    return "good";
  }
  if (/rejected|conflict|block/i.test(value)) {
    return "bad";
  }
  if (/pending|review|rework|recheck|draft|stale|not_ready/i.test(value)) {
    return "warn";
  }
  return "";
}

function deptBars(split) {
  const max = Math.max(1, ...split.map((row) => Number(row.count || 0)));
  if (!split.length) {
    return `<p class="muted">No applications yet.</p>`;
  }
  return `<div class="bars">${split.map((row) => `<div><span>${escapeHtml(row.department || "-")}</span><i style="--w:${(Number(row.count || 0) / max) * 100}%"></i><b>${Number(row.count || 0)}</b></div>`).join("")}</div>`;
}

function emptyState(message) {
  return `<div class="empty"><b>Nothing here yet</b><span>${escapeHtml(message)}</span></div>`;
}

function percent(value, total) {
  const denominator = Number(total || 0);
  if (!denominator) {
    return "0%";
  }
  return `${Math.round((Number(value || 0) / denominator) * 100)}%`;
}

function cycleStateLabel(state) {
  const labels = {
    applications_open: "Applications open",
    manager_approval: "Manager approvals",
    function_approval: "Function approvals",
    finalized: "Final dataset",
  };
  return labels[state] || state || "Current cycle";
}

function lockedField(label, name, value) {
  return `<label><span>${escapeHtml(label)}</span><input name="${name}" value="${escapeAttr(value)}" readonly></label>`;
}

function field(label, name, value, type, enabled, required, help = "") {
  return `<label><span>${escapeHtml(label)}${required ? " *" : ""}</span><input name="${name}" type="${type}" value="${escapeAttr(value || "")}" ${enabled ? "" : "readonly"} ${required ? "required" : ""}>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}

function selectField(label, name, value, options, enabled, required, help = "") {
  const choices = uniqueClean([value, ...options]).filter(Boolean);
  return `<label><span>${escapeHtml(label)}${required ? " *" : ""}</span><select name="${name}" ${enabled ? "" : "disabled"} ${required ? "required" : ""} data-field="${escapeAttr(name)}">
    <option value="">Select ${escapeHtml(label.toLowerCase())}</option>
    ${choices.map((choice) => option(choice, value, choice)).join("")}
  </select>${!enabled ? `<input type="hidden" name="${name}" value="${escapeAttr(value || "")}">` : ""}${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}

function textarea(label, name, value, enabled, required, help = "") {
  return `<label class="full"><span>${escapeHtml(label)}${required ? " *" : ""}</span><textarea name="${name}" ${enabled ? "" : "readonly"} ${required ? "required" : ""}>${escapeHtml(value || "")}</textarea>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}

function option(value, current, label) {
  return `<option value="${escapeAttr(value)}" ${String(value) === String(current) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function buildRouteOptions(routes, data = {}) {
  const activeRoutes = (routes || []).filter((route) => route.active !== 0);
  const byFunction = {};
  for (const route of activeRoutes) {
    const department = String(route.department || "").trim();
    const subDepartment = String(route.sub_department || "").trim();
    if (!department) {
      continue;
    }
    if (!byFunction[department]) {
      byFunction[department] = [];
    }
    if (subDepartment) {
      byFunction[department].push(subDepartment);
    }
  }
  for (const department of DEFAULT_FUNCTIONS) {
    if (!byFunction[department]) {
      byFunction[department] = [...(DEFAULT_FUNCTION_SUB_FUNCTIONS[department] || [])];
    }
  }
  if (data.department && !byFunction[data.department]) {
    byFunction[data.department] = data.sub_department ? [data.sub_department] : [];
  }
  for (const key of Object.keys(byFunction)) {
    byFunction[key] = uniqueClean(byFunction[key]);
  }
  const functions = uniqueClean([...Object.keys(byFunction), data.department]);
  const selectedSubs = data.department && Array.isArray(byFunction[data.department]) ? byFunction[data.department] : DEFAULT_SUB_FUNCTIONS;
  const subFunctions = uniqueClean([...selectedSubs, data.sub_department]);
  return { functions, subFunctions, byFunction };
}

function uniqueClean(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const cleanValue = String(value || "").trim();
    const key = cleanValue.toLowerCase();
    if (!cleanValue || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleanValue);
  }
  return out;
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function clientScript() {
  return `
(() => {
  const data = document.getElementById("route-options");
  const department = document.querySelector("[data-field='department']");
  const subDepartment = document.querySelector("[data-field='sub_department']");
  if (!data || !department || !subDepartment || subDepartment.disabled) return;
  let byFunction = {};
  try { byFunction = JSON.parse(data.textContent || "{}"); } catch { byFunction = {}; }
  const allOptions = Array.from(new Set(Object.values(byFunction).flat().filter(Boolean))).sort();
  const current = subDepartment.value;
  function fill() {
    const chosen = department.value;
    const options = chosen && Array.isArray(byFunction[chosen]) ? byFunction[chosen] : allOptions;
    const previous = subDepartment.value || current;
    subDepartment.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = options.length ? "Select sub-function if applicable" : "No sub-function needed";
    subDepartment.appendChild(empty);
    for (const optionText of options) {
      const option = document.createElement("option");
      option.value = optionText;
      option.textContent = optionText;
      if (optionText === previous) option.selected = true;
      subDepartment.appendChild(option);
    }
  }
  department.addEventListener("change", () => {
    subDepartment.value = "";
    fill();
  });
  fill();
})();
`;
}

function style() {
  return `
:root{
  --bg:#f5f7fa;
  --surface:#ffffff;
  --surface-2:#eef3f6;
  --surface-3:#f8fafb;
  --ink:#17202a;
  --muted:#64717e;
  --line:#d8e0e7;
  --line-strong:#b8c5d1;
  --nav:#142033;
  --green:#16785f;
  --green-soft:#e7f5ef;
  --blue:#2764a8;
  --blue-soft:#e8f0fb;
  --amber:#a96912;
  --amber-soft:#fff2d8;
  --coral:#c4473d;
  --coral-soft:#ffe7e3;
  --violet:#6658b8;
  --violet-soft:#f0edff;
  --shadow:0 18px 48px rgba(18,32,50,.08);
  --shadow-soft:0 8px 22px rgba(18,32,50,.06);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
  color:var(--ink);
  background:var(--bg);
}
*{box-sizing:border-box}
body{
  margin:0;
  min-width:320px;
  overflow-x:hidden;
  background:
    linear-gradient(180deg,#ffffff 0,#f5f7fa 260px),
    var(--bg);
  color:var(--ink);
  font-size:15px;
  line-height:1.45;
}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit}
button,.primary,.secondary,.danger{
  border:1px solid transparent;
  border-radius:7px;
  min-height:38px;
  padding:9px 13px;
  font-weight:760;
  cursor:pointer;
  transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .16s ease;
}
button:hover,.primary:hover,.secondary:hover,.danger:hover{transform:translateY(-1px);box-shadow:var(--shadow-soft)}
.primary{background:var(--green);color:#fff;display:inline-flex;align-items:center;justify-content:center}
.primary:hover{background:#11694f}
.secondary{background:#fff;border-color:var(--line-strong);color:#25313d;display:inline-flex;align-items:center;justify-content:center}
.secondary:hover{background:#f8fafb;border-color:#96a6b5}
.danger{background:var(--coral-soft);border-color:#efb2aa;color:#893128}
.small{min-height:30px;padding:5px 9px;font-size:13px}
input,select,textarea{
  width:100%;
  min-width:0;
  max-width:100%;
  border:1px solid var(--line-strong);
  border-radius:7px;
  background:#fff;
  color:var(--ink);
  padding:10px 11px;
}
textarea{min-height:102px;resize:vertical}
input[readonly],textarea[readonly]{background:#f4f7f9;color:#566371}
input:focus,select:focus,textarea:focus{
  outline:0;
  border-color:var(--blue);
  box-shadow:0 0 0 3px rgba(39,100,168,.14);
}
button:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.shell{display:grid;grid-template-columns:276px minmax(0,1fr);min-height:100vh;max-width:100vw}
.side{
  position:sticky;
  top:0;
  height:100vh;
  background:var(--nav);
  color:#eaf0f6;
  border-right:1px solid rgba(255,255,255,.08);
  padding:22px 16px;
  display:flex;
  flex-direction:column;
  gap:22px;
}
.brand{display:grid;gap:10px;min-width:0}
.brand b{display:block;font-size:18px;line-height:1.15}
.brand small{display:block;margin-top:3px;color:#aebdcb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brand-copy{padding:0 2px}
.logo-tile{
  display:block;
  width:min(244px,100%);
  border-radius:8px;
  background:#fff;
  border:1px solid rgba(255,255,255,.16);
  padding:8px 10px;
  box-shadow:0 10px 24px rgba(0,0,0,.12);
  overflow:hidden;
}
.logo-tile img{display:block;width:100%;height:auto;max-width:100%;object-fit:contain}
.mark{
  width:43px;
  height:43px;
  flex:0 0 auto;
  background:#0d1624;
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:5px;
  padding:6px;
  border:1px solid rgba(255,255,255,.11);
  border-radius:8px;
}
.mark i{border-radius:3px;background:#ffd166}
.mark i:nth-child(2){background:#5db6a4}
.mark i:nth-child(3){background:#ef6f61}
.mark i:nth-child(4){background:#7aa5df}
nav{display:grid;gap:7px}
nav a{
  padding:10px 11px;
  border-radius:7px;
  font-weight:760;
  color:#cbd6e2;
  display:flex;
  align-items:center;
  justify-content:space-between;
}
nav a:hover{background:rgba(255,255,255,.08);color:#fff}
nav a.active{background:#ffffff;color:#142033;box-shadow:0 10px 24px rgba(0,0,0,.14)}
.role-switch{
  border-top:1px solid rgba(255,255,255,.10);
  border-bottom:1px solid rgba(255,255,255,.10);
  padding:10px 0;
}
.cycle-card,.who{
  border:1px solid rgba(255,255,255,.12);
  border-radius:8px;
  padding:12px;
  background:rgba(255,255,255,.06);
  display:grid;
  gap:2px;
  min-width:0;
}
.cycle-card small,.who small{color:#aebdcb;font-weight:760;text-transform:uppercase;font-size:11px;letter-spacing:0}
.cycle-card b,.who b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cycle-card span,.who span{color:#cbd6e2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who{margin-top:auto}
.test-switch{display:grid;gap:7px;margin-top:8px}
.side-button{
  display:flex;
  align-items:center;
  justify-content:center;
  width:100%;
  min-height:32px;
  border:1px solid rgba(255,255,255,.20);
  background:rgba(255,255,255,.08);
  color:#fff;
  border-radius:7px;
  padding:6px 8px;
  font-size:13px;
  font-weight:760;
}
.side-button.quiet{background:transparent;color:#cbd6e2}
.muted,td span,li span{color:var(--muted)}
main{min-width:0;padding:28px;max-width:1480px;width:100%;margin:0 auto}
.top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:20px}
.top>div{min-width:0;max-width:100%}
.top h1{margin:0;font-size:30px;letter-spacing:0;line-height:1.12}
.top .actions{justify-content:flex-end}
.top-note{margin:7px 0 0;color:var(--muted);max-width:100%;white-space:normal;overflow-wrap:break-word}
.eyebrow{margin:0 0 5px;color:#667381;font-size:12px;font-weight:850;letter-spacing:0;text-transform:uppercase}
.panel{
  background:rgba(255,255,255,.96);
  border:1px solid var(--line);
  border-radius:8px;
  box-shadow:var(--shadow-soft);
  padding:18px;
}
.panel h2{font-size:18px;line-height:1.2;margin:0 0 12px}
.panel p{color:var(--muted);margin:0 0 14px}
.feature-panel{min-height:240px}
.grid{display:grid;gap:18px;margin-bottom:18px}
.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.applicant-hero{
  position:relative;
  min-height:410px;
  display:grid;
  grid-template-columns:minmax(0,1fr) 280px;
  gap:24px;
  align-items:end;
  border:1px solid #cfe4dd;
  border-radius:8px;
  background:
    linear-gradient(135deg,rgba(22,120,95,.14),rgba(255,209,102,.16) 45%,rgba(93,182,164,.18)),
    #fff;
  box-shadow:var(--shadow);
  margin-bottom:18px;
  padding:34px;
  overflow:hidden;
}
.hero-copy{position:relative;z-index:1;max-width:820px}
.hero-copy h1{
  margin:0;
  font-size:48px;
  line-height:1.02;
  letter-spacing:0;
  max-width:780px;
}
.hero-copy p{margin:14px 0 0;color:#445565;font-size:17px;max-width:700px}
.hero-cta{min-height:46px;padding-inline:18px}
.hero-ticket{
  position:relative;
  z-index:1;
  display:grid;
  gap:6px;
  background:rgba(255,255,255,.86);
  border:1px solid rgba(20,32,51,.12);
  border-radius:8px;
  padding:18px;
  box-shadow:var(--shadow-soft);
}
.hero-ticket small{color:var(--green);font-weight:850;text-transform:uppercase;font-size:12px}
.hero-ticket b{font-size:25px;line-height:1.08}
.hero-ticket span{color:var(--muted)}
.hero-art{
  position:absolute;
  inset:0;
  pointer-events:none;
  opacity:.9;
}
.hero-art span{
  position:absolute;
  width:70px;
  height:16px;
  border-radius:999px;
  background:#ffd166;
  transform:rotate(-18deg);
}
.hero-art span:nth-child(1){right:80px;top:72px;background:#16785f}
.hero-art span:nth-child(2){right:190px;top:130px;background:#ef6f61;width:44px}
.hero-art span:nth-child(3){left:52px;bottom:72px;background:#5db6a4;width:98px}
.hero-art span:nth-child(4){right:42px;bottom:96px;background:#2764a8;width:116px}
.hero-art span:nth-child(5){left:45%;top:48px;background:#ffd166;width:58px}
.experience-path{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  margin-bottom:18px;
}
.experience-path article{
  background:#fff;
  border:1px solid var(--line);
  border-radius:8px;
  box-shadow:var(--shadow-soft);
  padding:15px;
  display:grid;
  grid-template-columns:34px minmax(0,1fr);
  gap:9px 12px;
  align-items:start;
}
.experience-path span{
  width:34px;
  height:34px;
  border-radius:8px;
  display:grid;
  place-items:center;
  background:var(--green);
  color:#fff;
  font-weight:850;
}
.experience-path b{line-height:1.2}
.experience-path small{grid-column:2;color:var(--muted)}
.applicant-panel{min-height:210px}
.home-actions{display:flex;gap:9px;flex-wrap:wrap}
.snapshot{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.snapshot div{
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--surface-3);
  padding:14px;
}
.snapshot small{display:block;color:var(--muted);font-weight:850;text-transform:uppercase;font-size:12px}
.snapshot b{display:block;font-size:34px;line-height:1}
.form-steps{
  position:sticky;
  top:0;
  z-index:5;
  display:flex;
  gap:8px;
  overflow:auto;
  width:100%;
  max-width:100%;
  min-width:0;
  padding:0 0 12px;
  margin-bottom:6px;
  background:linear-gradient(180deg,#fff 0,#fff 70%,rgba(255,255,255,0));
}
.form-steps a{
  flex:0 0 auto;
  min-width:104px;
  text-align:center;
  background:#fff;
  border:1px solid var(--line-strong);
  border-radius:8px;
  padding:9px 13px;
  font-weight:850;
  color:#25313d;
  box-shadow:var(--shadow-soft);
}
.form-chapter{
  display:grid;
  grid-template-columns:34px minmax(0,1fr);
  gap:12px;
  align-items:start;
  border-top:1px solid var(--line);
  padding-top:18px;
  scroll-margin-top:70px;
}
.form-chapter:first-child{border-top:0;padding-top:0}
.form-chapter span{
  width:34px;
  height:34px;
  border-radius:8px;
  display:grid;
  place-items:center;
  background:#142033;
  color:#fff;
  font-weight:850;
  flex:0 0 auto;
}
.form-chapter h2{margin:0 0 3px;font-size:20px}
.form-chapter>div{min-width:0;max-width:100%}
.form-chapter p{margin:0;color:var(--muted);overflow-wrap:break-word}
.ops-strip{
  display:grid;
  grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);
  gap:18px;
  align-items:start;
  margin-bottom:18px;
}
.ops-card,.stage-card,.utility{
  background:rgba(255,255,255,.96);
  border:1px solid var(--line);
  border-radius:8px;
  box-shadow:var(--shadow-soft);
  padding:18px;
}
.priority-card{border-color:#d8e2ea}
.attention-list{
  list-style:none;
  margin:0;
  padding:0;
  display:grid;
  gap:10px;
}
.attention-list li{
  display:grid;
  grid-template-columns:12px minmax(0,1fr) auto;
  gap:11px;
  align-items:center;
  border-top:1px solid var(--line);
  padding-top:10px;
}
.attention-list li:first-child{border-top:0;padding-top:0}
.attention-list b{display:block;line-height:1.2}
.attention-list div{min-width:0}
.attention-list small{display:block;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}
.signal{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#c2ccd6;
}
.attention-list .warn .signal{background:var(--amber)}
.attention-list .bad .signal{background:var(--coral)}
.ops-numbers{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:14px 18px;
}
.ops-numbers div{
  min-width:0;
  border-top:1px solid var(--line);
  padding-top:10px;
}
.ops-numbers div:nth-child(-n+2){border-top:0;padding-top:0}
.ops-numbers small{display:block;color:var(--muted);font-weight:850;text-transform:uppercase;font-size:11px}
.ops-numbers b{display:block;font-size:33px;line-height:1}
.ops-numbers span{color:var(--muted)}
.stage-board{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:14px;
  margin-bottom:18px;
}
.stage-card{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:6px 12px;
  align-items:end;
  min-height:138px;
}
.stage-card .stage-line{
  grid-column:1/-1;
  height:5px;
  border-radius:999px;
  background:#c2ccd6;
}
.stage-card.current .stage-line{background:var(--amber)}
.stage-card.done .stage-line{background:var(--green)}
.stage-card small{grid-column:1/-1;color:var(--muted);font-weight:850;text-transform:uppercase;font-size:12px}
.stage-card b{font-size:36px;line-height:1}
.stage-card em{font-style:normal;color:var(--muted)}
.stage-card a,.stage-card form{justify-self:end}
.stage-card button{white-space:nowrap}
.admin-work-grid{align-items:start}
.utility-stack{
  display:grid;
  gap:12px;
  margin-bottom:18px;
}
.utility{padding:0;overflow:hidden}
.utility summary{
  list-style:none;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:16px 18px;
  cursor:pointer;
  font-weight:850;
}
.utility summary::-webkit-details-marker{display:none}
.utility summary small{font-weight:650;color:var(--muted);text-align:right}
.utility[open] summary{border-bottom:1px solid var(--line);background:#f8fafb}
.utility>form,.utility>.plain,.utility>p{margin:18px}
.utility>.form{margin:18px}
.welcome-band,.cockpit-band,.review-hero{
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(220px,320px);
  gap:20px;
  align-items:end;
  margin-bottom:20px;
  border:1px solid var(--line);
  border-radius:8px;
  background:
    linear-gradient(135deg,rgba(22,120,95,.12),rgba(39,100,168,.10) 48%,rgba(102,88,184,.09)),
    #fff;
  box-shadow:var(--shadow);
  padding:26px;
  overflow:hidden;
}
.welcome-copy h1,.review-hero h1{
  margin:0;
  max-width:820px;
  font-size:38px;
  line-height:1.08;
  letter-spacing:0;
}
.welcome-copy p,.review-hero p,.cockpit-band p{max-width:780px;color:#536171;margin:10px 0 0}
.welcome-status,.review-count{
  justify-self:end;
  width:100%;
  display:grid;
  gap:8px;
  align-content:end;
  padding:16px;
  border:1px solid rgba(20,32,51,.12);
  border-radius:8px;
  background:rgba(255,255,255,.72);
}
.welcome-status b,.review-count b{font-size:25px;line-height:1.1}
.welcome-status small,.review-count span{color:var(--muted)}
.cockpit-band{align-items:center}
.cockpit-band h2{font-size:26px;margin:10px 0 0}
.workflow-progress{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
.progress-step{
  min-width:0;
  border:1px solid var(--line);
  border-radius:8px;
  background:#fff;
  padding:11px;
  display:grid;
  gap:4px;
}
.progress-step span{
  width:10px;
  height:10px;
  border-radius:999px;
  background:#c2ccd6;
}
.progress-step.done span{background:var(--green)}
.progress-step.current span{background:var(--amber)}
.progress-step b{font-size:13px}
.progress-step em{font-size:24px;line-height:1;font-style:normal;font-weight:850}
.progress-step small{color:var(--muted)}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
.metrics.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.metric-card{
  position:relative;
  overflow:hidden;
  background:#fff;
  border:1px solid var(--line);
  border-radius:8px;
  padding:16px;
  box-shadow:var(--shadow-soft);
  display:grid;
  gap:4px;
  min-height:120px;
}
.metric-card:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--blue)}
.metric-card.green:before{background:var(--green)}
.metric-card.amber:before{background:var(--amber)}
.metric-card.coral:before{background:var(--coral)}
.metric-card.violet:before{background:var(--violet)}
.metric-card small{color:var(--muted);font-weight:850;text-transform:uppercase;font-size:12px;letter-spacing:0}
.metric-card b{font-size:34px;line-height:1.02}
.metric-card span{color:var(--muted)}
.gmail-readiness{margin-bottom:18px}
.gmail-panel{
  display:grid;
  gap:8px;
  border:1px solid var(--line);
  background:var(--surface-3);
  border-radius:8px;
  padding:14px;
}
.gmail-panel.connected{background:var(--green-soft);border-color:#a7dac8}
.gmail-panel.local{background:var(--blue-soft);border-color:#b7cff0}
.gmail-panel span{color:var(--muted)}
.section-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:13px}
.section-head h2{margin:0}
.actions{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
.form.compact textarea{min-height:74px}
.form label{min-width:0}
.form label span{display:block;margin-bottom:6px;color:#364454;font-weight:760}
.form label small{display:block;margin-top:6px;color:var(--muted);font-size:13px;line-height:1.35;max-width:100%;white-space:normal;overflow-wrap:break-word}
.full{grid-column:1/-1}
.form-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start}
.form-layout,.application-form{min-width:0}
.form-aside{
  position:sticky;
  top:20px;
  display:grid;
  gap:12px;
}
.form-aside>div{
  border:1px solid var(--line);
  border-radius:8px;
  background:#fff;
  box-shadow:var(--shadow-soft);
  padding:14px;
  display:grid;
  gap:3px;
  min-width:0;
}
.form-aside small{color:var(--muted);font-weight:850;text-transform:uppercase;font-size:11px;letter-spacing:0}
.form-aside b,.form-aside span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.application-form{align-items:start}
.form-section{
  border-top:1px solid var(--line);
  padding-top:15px;
  margin-top:5px;
}
.form-section:first-child{border-top:0;padding-top:0;margin-top:0}
.form-section h2{margin:0 0 3px;font-size:17px}
.form-section p{margin:0;color:var(--muted)}
.alignment-check{
  border:1px solid var(--line);
  background:var(--surface-3);
  border-radius:8px;
  padding:12px;
}
.form-actions{border-top:1px solid var(--line);padding-top:14px;margin-top:3px}
.check{display:flex;align-items:center;gap:9px}
.check input{width:18px;height:18px;accent-color:var(--green);flex:0 0 auto}
.check span{margin:0}
.filters,.inline{
  display:grid;
  grid-template-columns:minmax(220px,1fr) 190px 170px auto;
  gap:10px;
  margin-bottom:13px;
  align-items:start;
}
.inline.route-add{grid-template-columns:minmax(180px,1fr) minmax(220px,1fr) auto;margin:13px 0 0}
.table-wrap{
  overflow:auto;
  border:1px solid var(--line);
  border-radius:8px;
  background:#fff;
}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;min-width:940px}
th,td{padding:12px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{
  position:sticky;
  top:0;
  z-index:1;
  background:#eef3f6;
  color:#405060;
  font-size:12px;
  letter-spacing:0;
  text-transform:uppercase;
}
tbody tr:last-child td{border-bottom:0}
tr:hover td{background:#f8fafb}
td b{font-weight:850}
.pill,.tag{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:999px;
  padding:4px 9px;
  min-height:24px;
  font-size:12px;
  font-weight:850;
  background:#edf2f5;
  color:#344554;
  margin:2px;
  white-space:nowrap;
}
.pill.good,.tag.good{background:var(--green-soft);color:#116147}
.pill.warn,.tag.warn{background:var(--amber-soft);color:#714807}
.pill.bad,.tag.bad{background:var(--coral-soft);color:#843128}
.notice{
  border:1px solid #edc272;
  border-radius:8px;
  background:var(--amber-soft);
  color:#674206;
  padding:11px 12px;
  margin:0 0 14px;
  font-weight:760;
}
.notice.bad{background:var(--coral-soft);border-color:#e9a79e;color:#843128}
.notice.good{background:var(--green-soft);border-color:#a7dac8;color:#105f45}
.details{display:grid;grid-template-columns:150px minmax(0,1fr);gap:9px 13px;margin:0}
.details dt{font-weight:850;color:#4d5a67}
.details dd{margin:0;color:#263443;overflow-wrap:anywhere}
.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.status-grid div{
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--surface-3);
  padding:12px;
}
.status-grid small{display:block;color:var(--muted);font-weight:850;margin-bottom:5px}
.journey-panel{margin-bottom:18px}
.journey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.journey-step{
  border:1px solid var(--line);
  border-radius:8px;
  background:#fff;
  padding:13px;
  display:grid;
  gap:7px;
  min-height:104px;
}
.journey-step span{
  width:28px;
  height:6px;
  border-radius:999px;
  background:#c4ced8;
}
.journey-step.done span,.journey-step.good span{background:var(--green)}
.journey-step.warn span{background:var(--amber)}
.journey-step.bad span{background:var(--coral)}
.journey-step b{font-size:15px}
.journey-step small{color:var(--muted);overflow-wrap:anywhere}
.mini-status{display:grid;gap:2px;margin-bottom:6px}
.mini-status b{font-size:12px;color:#566371}
.plain,.versions{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.plain li,.versions li{
  border:1px solid var(--line);
  border-radius:8px;
  background:var(--surface-3);
  padding:12px;
  display:grid;
  gap:3px;
}
.plain em,.versions em{color:#75818d;font-style:normal;font-size:13px}
.bars{display:grid;gap:10px}
.bars div{display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr) 40px;gap:10px;align-items:center}
.bars span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bars i{
  height:12px;
  border-radius:999px;
  background:linear-gradient(90deg,var(--blue),var(--green));
  width:var(--w);
  min-width:3px;
}
.bars b{text-align:right}
.mini{display:grid;grid-template-columns:minmax(170px,1fr) auto;gap:6px;margin-bottom:6px}
.mini button{white-space:nowrap}
.route-table{display:grid;gap:12px}
.route-table input{min-width:160px}
.chips{display:flex;flex-wrap:wrap;gap:7px}
.empty{
  min-height:130px;
  border:1px dashed var(--line-strong);
  border-radius:8px;
  background:var(--surface-3);
  padding:18px;
  display:grid;
  place-content:center;
  gap:5px;
  text-align:center;
}
.empty b{font-size:17px}
.empty span{color:var(--muted);max-width:420px}
.empty.tight{min-height:92px;text-align:left;place-content:start}
.review-mode{background:#f6f7fa}
.review{max-width:1120px;margin:0 auto;padding:28px}
.review-hero{grid-template-columns:minmax(0,1fr) 170px}
.review-count{justify-items:start}
.review-count b{font-size:40px}
.review-item{margin-bottom:16px}
.review-actions{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto auto auto;
  gap:9px;
  margin-top:13px;
}
.review-actions textarea{min-height:58px}
@media(max-width:1120px){
  .shell{grid-template-columns:244px minmax(0,1fr)}
  .metrics,.workflow-progress,.journey,.stage-board,.experience-path{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ops-strip{grid-template-columns:1fr}
  .welcome-band,.cockpit-band,.applicant-hero{grid-template-columns:1fr}
  .welcome-status{justify-self:stretch}
  .hero-ticket{max-width:360px}
}
@media(max-width:860px){
  body{font-size:14px}
  .shell{grid-template-columns:minmax(0,1fr);overflow:hidden}
  .side{position:static;height:auto;padding:16px;gap:14px;max-width:100vw;overflow:hidden}
  nav{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
  nav a{flex:0 0 auto;justify-content:center;text-align:center;min-width:104px}
  .role-switch{border:0;padding:0}
  .cycle-card,.who{display:none}
  main,.review{max-width:100vw;padding:16px}
  .top{flex-direction:column;align-items:stretch}
  .top-note{width:calc(100vw - 32px);max-width:100%}
  .top .actions{justify-content:flex-start}
  .welcome-copy h1,.review-hero h1,.hero-copy h1{font-size:31px}
  .two,.three,.metrics,.metrics.three,.form,.filters,.inline,.inline.route-add,.form-layout,.review-actions,.ops-strip{grid-template-columns:1fr}
  .form-aside{position:static}
  .application-form{width:100%;max-width:100%}
  .form-chapter{grid-template-columns:34px minmax(0,calc(100vw - 98px))}
  .form-chapter>div{width:calc(100vw - 98px);max-width:100%}
  .form label{width:100%;max-width:100%}
  .form label small{width:calc(100vw - 64px);max-width:100%}
  .form-steps{top:0}
  .details{grid-template-columns:1fr}
  .bars div{grid-template-columns:110px minmax(0,1fr) 34px}
  .review-hero{grid-template-columns:1fr}
}
@media(max-width:560px){
  .welcome-band,.cockpit-band,.review-hero,.applicant-hero{padding:18px}
  .applicant-hero{min-height:420px}
  .welcome-copy h1,.review-hero h1,.hero-copy h1{font-size:27px}
  .top-note{width:auto;max-width:335px}
  .top h1{font-size:26px;overflow-wrap:anywhere}
  .top .actions,.top .actions form{width:100%}
  .metrics,.workflow-progress,.journey,.status-grid,.stage-board,.experience-path,.snapshot{grid-template-columns:1fr}
  .attention-list li{grid-template-columns:10px minmax(0,1fr)}
  .attention-list a{grid-column:2;justify-self:start}
  .ops-numbers{grid-template-columns:1fr}
  .ops-numbers div:nth-child(2){border-top:1px solid var(--line);padding-top:10px}
  .stage-card{min-height:120px}
  .hero-ticket{max-width:none}
  .panel{padding:15px}
  .application-form{max-width:calc(100vw - 32px)}
  .application-form label{max-width:326px}
  .application-form .form-chapter>div{width:auto;max-width:260px}
  .application-form label small{width:auto;max-width:294px}
  .form-steps{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:7px;
    overflow:visible;
    width:min(100%,358px);
  }
  .form-steps a{min-width:0;padding:9px 6px;font-size:13px}
  .actions .primary,.actions .secondary,.actions .danger,.form-actions button,.form-actions a{width:100%}
  .bars div{grid-template-columns:1fr 1fr 30px}
}`;
}
