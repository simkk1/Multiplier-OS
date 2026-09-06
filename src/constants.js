export const DEFAULT_ADMIN_EMAIL = "admin@example.com";
export const DEFAULT_SENDER_EMAIL = "multipliers@example.com";
export const DEFAULT_ORG_EMAIL_DOMAIN = "example.com";

export const DEFAULT_FUNCTIONS = [
  "Man Matters",
  "BeBodywise",
  "Little Joys",
  "Root Labs",
  "Absolute Science",
  "OWN",
  "Tech",
  "Finance",
  "HR",
  "Marketplace",
  "Admin",
  "Supply Chain",
  "NPD",
  "Quality",
  "Legal",
  "CEO's Office",
  "CoE",
  "Offline",
];

export const DEFAULT_SUB_FUNCTIONS = [
  "Performance Mkt",
  "Content",
  "Product Design",
  "Product Manager",
  "Category",
  "Product Engineer",
  "TA",
  "HRBP",
  "NPD (Innovation)",
  "NPD (R&D)",
  "NPD Packaging & Development",
  "Tech (product)",
  "Tech (non product)",
  "Operations",
  "Retention",
  "Marketplace (P&L)",
  "Social Media",
  "Analytics",
];

export const DEFAULT_FUNCTION_SUB_FUNCTIONS = {
  "Man Matters": ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  BeBodywise: ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  "Little Joys": ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  "Root Labs": ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  "Absolute Science": ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  OWN: ["Performance Mkt", "Content", "Product Design", "Product Manager", "Category", "Retention", "Social Media", "Analytics"],
  Tech: ["Product Engineer", "Tech (product)", "Tech (non product)", "Analytics"],
  HR: ["TA", "HRBP"],
  Marketplace: ["Marketplace (P&L)"],
  "Supply Chain": ["Operations"],
  NPD: ["NPD (Innovation)", "NPD (R&D)", "NPD Packaging & Development"],
};

export const REQUIRED_FIELDS = [
  "applicant_name",
  "applicant_email",
  "manager_name",
  "manager_email",
  "department",
  "regular_okr",
  "multiplier_target",
  "baseline",
  "aop",
  "team_vision",
  "flywheel_parts",
  "flywheel",
  "manager_aligned",
];

export const MATERIAL_FIELDS = [
  "regular_okr",
  "multiplier_target",
  "baseline",
  "aop",
];

export const STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  recheck_needed: "Recheck needed",
  rework: "Rework needed",
  rejected: "Rejected with reason",
  skipped: "Team 1 manager-skipped",
  not_ready: "Not ready",
  done: "Done",
  sent: "Sent",
  draft: "Draft",
  conflict: "Conflict",
  stale_draft: "Stale draft",
  submitted: "Submitted",
  needs_admin_review: "Admin review",
  manager_pending: "Manager pending",
  manager_approved: "Manager approved",
  manager_recheck_needed: "Manager recheck needed",
  manager_rework: "Manager requested rework",
  manager_rejected: "Manager rejected with reason",
  manager_skipped: "Team 1 manager-skipped",
  function_not_ready: "Function not ready",
  function_pending: "Function pending",
  function_approved: "Function approved",
  function_rework: "Function requested rework",
  function_rejected: "Function rejected",
  function_conflict: "Function conflict",
  finalized: "Finalized",
};

export const OBJECTIVE_FLAG_COPY = {
  blank_required: "Blank required field",
  no_baseline: "No baseline",
  no_numeric_or_dated_target: "No numeric/dated target",
  multiplier_same_as_regular_okr: "Multiplier same as regular OKR",
  invalid_manager_email: "Invalid manager email",
  department_missing: "Department missing",
  subdepartment_missing: "Sub department missing",
  manager_not_aligned: "Applicant says manager is not aligned",
};
