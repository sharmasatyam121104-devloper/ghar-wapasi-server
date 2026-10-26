import type { ReportDocument } from "./reports.model";

export const toReport = (report: ReportDocument) => ({
    id: String(report._id),
    target_user_id: String(report.target_user_id),
    target_name: report.target_name,
    target_role: report.target_role,
    case_id: report.case_id ? String(report.case_id) : "",
    case_ref: report.case_ref ?? "",
    reported_by: String(report.reported_by),
    reporter_name: report.reporter_name,
    reporter_contact: report.reporter_contact,
    category: report.category,
    details: report.details,
    proof: report.proof ?? [],
    status: report.status,
    resolution: report.resolution,
    reviewed_by: report.reviewed_by ? String(report.reviewed_by) : "",
    reviewed_at: report.reviewed_at,
    created_at: report.created_at,
    updated_at: report.updated_at,
});
