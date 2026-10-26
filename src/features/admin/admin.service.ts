import { AuditLog } from "../audit/audit.model";
import { complaintScopeFilter } from "../complaints/complaints.service";
import { Complaint } from "../complaints/complaints.model";
import { Report } from "../reports/reports.model";
import { User, type UserDocument } from "../users/users.model";
import { assignedUserIds } from "./admin.scope";
import { Suspension } from "./suspension.model";
import { expireDueSuspensions } from "./suspension.service";

export const getOverview = async (viewer: UserDocument) => {
    await expireDueSuspensions();

    const ids = viewer.role === "admin" ? await assignedUserIds(viewer) : null;
    const userScope = ids ? { _id: { $in: ids } } : {};
    const targetScope = ids ? { target_user_id: { $in: ids } } : {};

    const complaintFilter = await complaintScopeFilter(viewer);
    const [pendingRequests, verifiedUsers, assignedUsers, openReports, reviewingReports, activeSuspensions, totalCases, activeCases, matchedCases, resolvedCases, recentReports, recentSuspensions] =
        await Promise.all([
            User.countDocuments({
                ...userScope,
                role: { $in: ["police", "ngo"] },
                verification_status: "pending",
            }),
            User.countDocuments({
                ...userScope,
                role: { $in: ["police", "ngo"] },
                verification_status: "verified",
            }),
            User.countDocuments(userScope),
            Report.countDocuments({ ...targetScope, status: "open" }),
            Report.countDocuments({ ...targetScope, status: "reviewing" }),
            Suspension.countDocuments({ ...targetScope, status: "active" }),
            Complaint.countDocuments(complaintFilter),
            Complaint.countDocuments({ ...complaintFilter, status: "active" }),
            Complaint.countDocuments({ ...complaintFilter, status: "matched" }),
            Complaint.countDocuments({ ...complaintFilter, status: "resolved" }),
            Report.find(targetScope).sort({ created_at: -1 }).limit(4),
            Suspension.find(targetScope).sort({ suspended_at: -1 }).limit(4),
        ]);

    return {
        stats: {
            pending_requests: pendingRequests,
            verified_users: verifiedUsers,
            assigned_users: assignedUsers,
            open_reports: openReports,
            reviewing_reports: reviewingReports,
            active_suspensions: activeSuspensions,
            total_cases: totalCases,
            active_cases: activeCases,
            matched_cases: matchedCases,
            resolved_cases: resolvedCases,
        },
        recent_reports: recentReports,
        recent_suspensions: recentSuspensions,
        is_superadmin: viewer.role === "superadmin",
    };
};

export const listAudit = async (viewer: UserDocument, limit = 100) => {
    const filter = viewer.role === "superadmin" ? {} : { actor_id: viewer._id };
    return AuditLog.find(filter).sort({ created_at: -1 }).limit(Math.min(200, Math.max(1, limit)));
};

