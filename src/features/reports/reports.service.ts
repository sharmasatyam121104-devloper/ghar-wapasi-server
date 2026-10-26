import { Types, type QueryFilter } from "mongoose";
import { ApiError } from "../../shared/errors/ApiError";
import { resolvePaging } from "../../shared/http/pagination";
import { listOfStrings } from "../registration/registration.shared";
import { recordAudit } from "../audit/audit.service";
import { Complaint } from "../complaints/complaints.model";
import { User, type UserDocument } from "../users/users.model";
import { assignedUserIds } from "../admin/admin.scope";
import { Report, type ReportDocument, type ReportInterface, type ReportStatus } from "./reports.model";

const STATUSES: readonly ReportStatus[] = ["open", "reviewing", "closed"];

const trim = (value: unknown, max: number): string => {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text.length > max ? text.slice(0, max) : text;
};

export interface ReportListResult {
    reports: ReportDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export const createReport = async (
    viewer: UserDocument,
    body: Record<string, unknown>,
): Promise<ReportDocument> => {
    const targetId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
    if (!Types.ObjectId.isValid(targetId)) throw ApiError.unprocessable("Choose a valid account to report.");
    if (targetId === String(viewer._id)) throw ApiError.unprocessable("You cannot report your own account.");

    const target = await User.findById(targetId);
    if (!target) throw ApiError.notFound("That account could not be found.");
    if (target.role === "admin" || target.role === "superadmin") {
        throw ApiError.forbidden("Administrator accounts cannot be reported through this endpoint.");
    }

    const category = trim(body.category, 120);
    const details = trim(body.details, 2000);
    if (!category) throw ApiError.unprocessable("Choose a report category.");
    if (details.length < 10) throw ApiError.unprocessable("Please describe the issue in at least 10 characters.");

    let caseId: Types.ObjectId | undefined;
    let caseRef = "";
    if (typeof body.case_id === "string" && body.case_id.trim()) {
        if (!Types.ObjectId.isValid(body.case_id)) throw ApiError.unprocessable("That case reference is invalid.");
        const complaint = await Complaint.findById(body.case_id);
        if (!complaint) throw ApiError.notFound("That case could not be found.");
        if (String(complaint.created_by) !== String(viewer._id)) {
            throw ApiError.forbidden("You can only link a case you filed.");
        }
        caseId = complaint._id;
        caseRef = complaint.case_ref ?? "";
    }

    const proof = listOfStrings(body.proof)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((item) => item.slice(0, 300));

    return Report.create({
        target_user_id: target._id,
        target_name: `${target.first_name} ${target.last_name}`.trim(),
        target_role: target.role,
        case_id: caseId,
        case_ref: caseRef,
        reported_by: viewer._id,
        reporter_name: `${viewer.first_name} ${viewer.last_name}`.trim(),
        reporter_contact: viewer.email || viewer.mobile,
        category,
        details,
        proof,
        status: "open",
    });
};

/** A reporter can see only their own submissions. */
export const listMyReports = async (viewer: UserDocument): Promise<ReportDocument[]> =>
    Report.find({ reported_by: viewer._id }).sort({ created_at: -1 }).limit(50);

const listFilter = async (
    viewer: UserDocument,
    status?: string,
): Promise<QueryFilter<ReportInterface>> => {
    const filter: QueryFilter<ReportInterface> = {};
    if (viewer.role === "admin") {
        filter.target_user_id = { $in: await assignedUserIds(viewer) };
    }
    if (status && STATUSES.includes(status as ReportStatus)) filter.status = status as ReportStatus;
    return filter;
};

export const listReports = async (
    viewer: UserDocument,
    query: { page?: number; limit?: number; status?: string } = {},
): Promise<ReportListResult> => {
    const filter = await listFilter(viewer, query.status);
    const { page, limit } = resolvePaging({ page: query.page, limit: query.limit });
    const [reports, total] = await Promise.all([
        Report.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit),
        Report.countDocuments(filter),
    ]);
    return { reports, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
};

export const getScopedReport = async (viewer: UserDocument, id: string): Promise<ReportDocument> => {
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound("That report could not be found.");
    const report = await Report.findById(id);
    if (!report) throw ApiError.notFound("That report could not be found.");

    if (viewer.role !== "superadmin") {
        const target = await User.findById(report.target_user_id).select("assigned_admin_id");
        if (!target || String(target.assigned_admin_id ?? "") !== String(viewer._id)) {
            throw ApiError.notFound("That report could not be found.");
        }
    }
    return report;
};

export const updateReport = async (
    viewer: UserDocument,
    id: string,
    body: Record<string, unknown>,
): Promise<ReportDocument> => {
    const report = await getScopedReport(viewer, id);

    const status = body.status;
    if (typeof status !== "string" || !STATUSES.includes(status as ReportStatus)) {
        throw ApiError.unprocessable("Choose a valid report status.");
    }

    const resolution = trim(body.resolution, 2000);
    if (status === "closed" && resolution.length < 3) {
        throw ApiError.unprocessable("Write a short resolution before closing the report.");
    }

    report.status = status as ReportStatus;
    report.resolution = resolution;
    report.reviewed_by = viewer._id;
    report.reviewed_at = new Date();
    await report.save();

    await recordAudit(viewer, {
        action: "report.update",
        targetType: "report",
        targetId: String(report._id),
        detail: `Set report against ${report.target_name} to ${report.status}.`,
    });
    return report;
};
