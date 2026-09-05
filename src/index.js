import {
  auditForEntity,
  auditList,
  completeTask,
  createTask,
  addRoute,
  addTeam1Manager,
  dashboardStats,
  deptSplit,
  ensureBoot,
  finalParticipants,
  finalizeDataset,
  getLatestSubmissions,
  getSubmission,
  getSubmissionByEmail,
  getVersions,
  listApplicantTasks,
  listRoutes,
  listSnapshots,
  listTasks,
  listTeam1,
  restoreVersion,
  saveSnapshot,
  startNewQuarter,
  submitApplication,
  updateCycle,
  updateRouteEmails,
} from "./db.js";
import { readUser, requireAdmin, requireMosaic, testAuthRoute } from "./auth.js";
import {
  listApprovalRequests,
  prepareFunctionRequests,
  prepareManagerRequests,
  recordReviewAction,
  remindersAndEscalations,
  requestByToken,
  requestItems,
  sendOrDraftRequest,
  syncGmailReplies,
} from "./approvals.js";
import { gmailConfigured, gmailErrorMessage, gmailStatus, sendGmail } from "./email.js";
import { makeXlsx } from "./xlsx.js";
import {
  adminApprovals,
  adminDashboard,
  adminSubmissions,
  applicantForm,
  applicantHome,
  applicantStatus,
  auditPage,
  layout,
  reviewPage,
  routesPage,
  tasksPage,
  submissionDetail,
} from "./views.js";
import { formData, html, json, localStamp, redirect, rowData } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const cycle = await ensureBoot(env);
      await enforceWindow(env, cycle);
      return await route(request, env, await ensureBoot(env), ctx);
    } catch (error) {
      return html(errorPage(error), { status: 500 });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};

async function route(request, env, cycle, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const user = await readUser(request, env, ctx);

  if (path === "/healthz" && request.method === "GET") {
    return json({ ok: true, cycle: cycle.name, gmail: gmailConfigured(env) });
  }

  const testAuth = await testAuthRoute(request, env);
  if (testAuth) {
    return testAuth;
  }

  if (path.startsWith("/api/")) {
    return apiRoute(request, env, cycle, user);
  }

  const reviewMatch = path.match(/^\/review\/([a-f0-9]+)$/);
  if (reviewMatch) {
    return reviewRoute(request, env, cycle, reviewMatch[1]);
  }

  const companyLoginBlock = requireMosaic(user, cycle, request, env);
  if (companyLoginBlock) {
    return companyLoginBlock;
  }

  if (path === "/" && request.method === "GET") {
    if (user.isAdmin) {
      return redirect("/admin");
    }
    const submission = await getSubmissionByEmail(env, cycle.id, user.email);
    const stats = await dashboardStats(env, cycle.id);
    const split = await deptSplit(env, cycle.id);
    return page({ title: "Home", user, cycle, active: "home", content: applicantHome({ user, cycle, submission, stats, split }) });
  }

  if (path === "/apply" && request.method === "GET") {
    const [submission, routes] = await Promise.all([getSubmissionByEmail(env, cycle.id, user.email), listRoutes(env, cycle.id)]);
    return page({ title: "Apply", user, cycle, active: "apply", content: applicantForm({ user, cycle, submission, routes }) });
  }

  if (path === "/apply" && request.method === "POST") {
    const [submission, routes] = await Promise.all([getSubmissionByEmail(env, cycle.id, user.email), listRoutes(env, cycle.id)]);
    if (!cycle.application_open && !(cycle.edit_open && submission)) {
      return page({ title: "Apply", user, cycle, active: "apply", content: applicantForm({ user, cycle, submission, routes, error: "Applications closed. Admin can open cohort edit access." }) });
    }
    try {
      await submitApplication(env, cycle, user, await formData(request));
      return redirect("/status");
    } catch (error) {
      return page({ title: "Apply", user, cycle, active: "apply", content: applicantForm({ user, cycle, submission, routes, error: error.message }) });
    }
  }

  if (path === "/status" && request.method === "GET") {
    const submission = await getSubmissionByEmail(env, cycle.id, user.email);
    const versions = submission ? await getVersions(env, submission.id) : [];
    const tasks = submission ? await listApplicantTasks(env, cycle.id, submission.id) : [];
    return page({ title: "Status", user, cycle, active: "status", content: applicantStatus({ submission, versions, tasks }) });
  }

  if (path.startsWith("/admin")) {
    const adminBlock = requireAdmin(user, request, env);
    if (adminBlock) {
      return adminBlock;
    }
    return adminRoute(request, env, cycle, user);
  }

  return html("Not found", { status: 404 });
}

async function adminRoute(request, env, cycle, user) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/admin" && request.method === "GET") {
    const [stats, split, tasks, requests, snapshots] = await Promise.all([
      dashboardStats(env, cycle.id),
      deptSplit(env, cycle.id),
      listTasks(env, cycle.id),
      listApprovalRequests(env, cycle.id),
      listSnapshots(env, cycle.id),
    ]);
    return page({ title: "Admin", user, cycle, active: "admin", content: adminDashboard({ cycle, stats, tasks, requests, snapshots, split, gmail: gmailStatus(env, request) }) });
  }

  if (path === "/admin/settings" && request.method === "POST") {
    await updateCycle(env, await formData(request), user.email);
    return redirect("/admin");
  }

  if (path === "/admin/submissions" && request.method === "GET") {
    const filters = {
      q: url.searchParams.get("q") || "",
      department: url.searchParams.get("department") || "",
      status: url.searchParams.get("status") || "",
    };
    const rows = await getLatestSubmissions(env, cycle.id, filters);
    return page({ title: "Database", user, cycle, active: "submissions", content: adminSubmissions({ rows, filters }) });
  }

  const detailMatch = path.match(/^\/admin\/submission\/(\d+)$/);
  if (detailMatch && request.method === "GET") {
    const row = await getSubmission(env, Number(detailMatch[1]));
    if (!row || row.cycle_id !== cycle.id) {
      return html("Submission not found", { status: 404 });
    }
    const versions = await getVersions(env, row.id);
    const audit = await auditForEntity(env, cycle.id, "submission", row.id);
    const content = submissionDetail({ row, versions, audit });
    return page({ title: row.applicant_name, user, cycle, active: "submissions", content });
  }

  const editMatch = path.match(/^\/admin\/submission\/(\d+)\/edit$/);
  if (editMatch && request.method === "POST") {
    const row = await getSubmission(env, Number(editMatch[1]));
    if (!row || row.cycle_id !== cycle.id) {
      return html("Submission not found", { status: 404 });
    }
    await submitApplication(env, cycle, user, await formData(request), "admin");
    return redirect(`/admin/submission/${row.id}`);
  }

  const restoreMatch = path.match(/^\/admin\/submission\/(\d+)\/restore$/);
  if (restoreMatch && request.method === "POST") {
    const data = await formData(request);
    await restoreVersion(env, cycle.id, Number(restoreMatch[1]), Number(data.version_id), user.email);
    return redirect(`/admin/submission/${restoreMatch[1]}`);
  }

  if (path === "/admin/approvals" && request.method === "GET") {
    const requests = await listApprovalRequests(env, cycle.id);
    return page({
      title: "Approvals",
      user,
      cycle,
      active: "approvals",
      content: adminApprovals({
        requests,
        gmail: gmailStatus(env, request),
        notice: url.searchParams.get("notice") || "",
        noticeTone: url.searchParams.get("tone") || "",
      }),
    });
  }

  if (path === "/admin/approvals/manager/prepare" && request.method === "POST") {
    await prepareManagerRequests(env, cycle, request);
    return redirect("/admin/approvals");
  }

  if (path === "/admin/approvals/function/prepare" && request.method === "POST") {
    await prepareFunctionRequests(env, cycle, request);
    return redirect("/admin/approvals");
  }

  const approvalSend = path.match(/^\/admin\/approvals\/(\d+)\/(test|send|draft)$/);
  if (approvalSend && request.method === "POST") {
    const data = await formData(request);
    const mode = approvalSend[2] === "draft" ? "draft" : "send";
    const testTo = approvalSend[2] === "test" ? data.test_to || cycle.admin_email : "";
    try {
      await sendOrDraftRequest(env, cycle, Number(approvalSend[1]), mode, testTo);
      return redirectWithNotice("/admin/approvals", approvalSend[2] === "draft" ? "Gmail draft created." : "Gmail sent.", "good");
    } catch (error) {
      const message = await recordGmailFailure(env, cycle, error, `${approvalSend[2]} approval request`);
      return redirectWithNotice("/admin/approvals", message, "bad");
    }
  }

  if (path === "/admin/gmail/sync" && request.method === "POST") {
    try {
      const count = await syncGmailReplies(env, cycle);
      return redirectWithNotice("/admin/approvals", `Gmail sync complete. ${count} new replies processed.`, "good");
    } catch (error) {
      const message = await recordGmailFailure(env, cycle, error, "sync Gmail replies");
      return redirectWithNotice("/admin/approvals", message, "bad");
    }
  }

  if (path === "/admin/routes" && request.method === "GET") {
    const [routes, team1] = await Promise.all([listRoutes(env, cycle.id), listTeam1(env, cycle.id)]);
    return page({ title: "Routes", user, cycle, active: "routes", content: routesPage({ routes, team1 }) });
  }

  if (path === "/admin/routes" && request.method === "POST") {
    await updateRouteEmails(env, cycle.id, await formData(request), user.email);
    return redirect("/admin/routes");
  }

  if (path === "/admin/routes/add" && request.method === "POST") {
    await addRoute(env, cycle.id, await formData(request), user.email);
    return redirect("/admin/routes");
  }

  if (path === "/admin/team1/add" && request.method === "POST") {
    await addTeam1Manager(env, cycle.id, await formData(request), user.email);
    return redirect("/admin/routes");
  }

  if (path === "/admin/tasks" && request.method === "GET") {
    const tasks = await listTasks(env, cycle.id);
    return page({ title: "Tasks", user, cycle, active: "admin", content: tasksPage({ tasks }) });
  }

  const doneMatch = path.match(/^\/admin\/tasks\/(\d+)\/done$/);
  if (doneMatch && request.method === "POST") {
    await completeTask(env, cycle.id, Number(doneMatch[1]), user.email);
    return redirect("/admin/tasks");
  }

  if (path === "/admin/audit" && request.method === "GET") {
    const events = await auditList(env, cycle.id);
    return page({ title: "Audit", user, cycle, active: "audit", content: auditPage({ events }) });
  }

  if (path === "/admin/snapshot" && request.method === "POST") {
    const data = await formData(request);
    await saveSnapshot(env, cycle.id, data.label, user.email);
    return redirect("/admin");
  }

  if (path === "/admin/finalize" && request.method === "POST") {
    await finalizeDataset(env, cycle.id, user.email);
    return redirect("/admin");
  }

  if (path === "/admin/new-quarter" && request.method === "POST") {
    await startNewQuarter(env, user.email, await formData(request));
    return redirect("/admin");
  }

  if (path === "/admin/export.xlsx" && request.method === "GET") {
    return exportXlsx(env, cycle);
  }

  return html("Admin route not found", { status: 404 });
}

async function reviewRoute(request, env, cycle, token) {
  const req = await requestByToken(env, token);
  if (!req || req.cycle_id !== cycle.id) {
    return html("Review link not found", { status: 404 });
  }
  if (request.method === "POST") {
    const data = await formData(request);
    await recordReviewAction(env, req, Number(data.item_id), data.action, data.note || "", req.reviewer_email);
  }
  const items = await requestItems(env, req.id);
  const fresh = await requestByToken(env, token);
  return html(reviewPage({ request: fresh, items, message: request.method === "POST" ? "Saved." : "" }));
}

async function recordGmailFailure(env, cycle, error, context) {
  const message = gmailErrorMessage(error);
  await createTask(env, cycle.id, null, null, "gmail_setup", "Connect Gmail OAuth", `${context}: ${message}`, "blocker", "");
  return message;
}

function redirectWithNotice(path, message, tone = "") {
  const params = new URLSearchParams({ notice: message });
  if (tone) {
    params.set("tone", tone);
  }
  return redirect(`${path}?${params.toString()}`);
}

async function apiRoute(request, env, cycle, user) {
  const adminBlock = requireAdmin(user, request, env);
  if (adminBlock) {
    return json({ error: "Admin access needed" }, { status: 403 });
  }
  const path = new URL(request.url).pathname;
  if (path === "/api/health") {
    return json({ ok: true, cycle: cycle.name, gmail: gmailConfigured(env) });
  }
  return json({ error: "Not found" }, { status: 404 });
}

function page(props) {
  return html(layout(props));
}

async function exportXlsx(env, cycle) {
  const submissions = await getLatestSubmissions(env, cycle.id);
  const finals = await finalParticipants(env, cycle.id);
  const submissionRows = [
    ["Name", "Email", "Department", "Sub Department", "Manager", "Manager Email", "Regular OKR", "Baseline", "AOP", "Multiplier Target", "Manager Status", "Function Status", "Final Status", "Version", "Updated At"],
    ...submissions.map((row) => {
      const data = rowData(row);
      return [
        row.applicant_name,
        row.applicant_email,
        row.department,
        row.sub_department || "",
        row.manager_name,
        row.manager_email,
        data.regular_okr || "",
        data.baseline || "",
        data.aop || "",
        data.multiplier_target || "",
        row.manager_status,
        row.function_status,
        row.final_status,
        String(row.version_no || ""),
        row.updated_at,
      ];
    }),
  ];
  const finalRows = [
    ["Name", "Email", "Department", "Sub Department", "Version", "Finalized At"],
    ...finals.map((row) => [row.applicant_name, row.applicant_email, row.department, row.sub_department || "", String(row.version_id), row.finalized_at]),
  ];
  const bytes = makeXlsx([
    { name: "Latest submissions", rows: submissionRows },
    { name: "Final participants", rows: finalRows },
  ]);
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="multipliers-${cycle.name.replace(/[^a-z0-9]+/gi, "-")}.xlsx"`,
    },
  });
}

async function enforceWindow(env, cycle) {
  if (cycle.application_open && cycle.close_at && new Date(cycle.close_at).getTime() < Date.now()) {
    await env.DB.prepare("UPDATE cycles SET application_open = 0, state = 'manager_approval', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), cycle.id)
      .run();
  }
}

async function runScheduled(env) {
  const cycle = await ensureBoot(env);
  await enforceWindow(env, cycle);
  try {
    await syncGmailReplies(env, cycle);
  } catch (error) {
    await recordGmailFailure(env, cycle, error, "scheduled Gmail sync");
  }
  try {
    await remindersAndEscalations(env, cycle);
  } catch (error) {
    await recordGmailFailure(env, cycle, error, "scheduled approval reminders");
  }
  try {
    await sendDailyDigest(env, cycle);
  } catch (error) {
    await recordGmailFailure(env, cycle, error, "daily admin digest");
  }
}

async function sendDailyDigest(env, cycle) {
  if (!gmailConfigured(env)) {
    return;
  }
  if (!digestWindowOpen(cycle.daily_digest_time)) {
    return;
  }
  const date = localDateKey();
  const sent = await env.DB.prepare("SELECT id FROM cycle_memory WHERE cycle_id = ? AND kind = ? AND value_json = ?")
    .bind(cycle.id, "daily_digest_sent", JSON.stringify({ date }))
    .first();
  if (sent) {
    return;
  }
  const tasks = await listTasks(env, cycle.id);
  if (!tasks.length) {
    return;
  }
  const recent = tasks.filter((task) => new Date(task.created_at).getTime() >= Date.now() - 24 * 3600000);
  const overdue = tasks.filter((task) => task.due_at && new Date(task.due_at).getTime() < Date.now());
  const blockers = tasks.filter((task) => task.priority === "blocker");
  const body = [
    "Recent tasks",
    renderTaskText(recent),
    "",
    "Overdue tasks",
    renderTaskText(overdue),
    "",
    "Blockers",
    renderTaskText(blockers),
  ].join("\n");
  await sendGmail(env, {
    to: cycle.admin_email,
    subject: `Multipliers OS tasks - ${date}`,
    body,
  });
  await env.DB.prepare("INSERT INTO cycle_memory (cycle_id, kind, value_json) VALUES (?, ?, ?)")
    .bind(cycle.id, "daily_digest_sent", JSON.stringify({ date }))
    .run();
}

function renderTaskText(tasks) {
  if (!tasks.length) {
    return "- None";
  }
  return tasks.map((task) => `- ${task.title}${task.due_at ? ` (due ${localStamp(task.due_at)})` : ""}\n  ${task.details || ""}`).join("\n");
}

function localDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function digestWindowOpen(time) {
  const [hour, minute] = String(time || "08:00").split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const nowMinutes = Number(map.hour) * 60 + Number(map.minute);
  return nowMinutes >= hour * 60 + minute;
}

function errorPage(error) {
  const message = error?.message || "Unknown error";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Multipliers OS error</title><style>body{font-family:system-ui;padding:32px;line-height:1.45}pre{white-space:pre-wrap;background:#f7f7f7;padding:14px;border-radius:8px}</style></head><body><h1>Multipliers OS hit an error</h1><pre>${String(message).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></body></html>`;
}
