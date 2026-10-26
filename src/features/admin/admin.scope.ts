import type { Types } from "mongoose";
import { User, type UserDocument } from "../users/users.model";

/** Staff/user ids an admin is responsible for. A superadmin has no narrow scope. */
export const assignedUserIds = async (viewer: UserDocument): Promise<Types.ObjectId[]> => {
    if (viewer.role === "superadmin") return [];
    const users = await User.find({ assigned_admin_id: viewer._id }).select("_id").lean();
    return users.map((user) => user._id);
};

export const isWithinAdminScope = (
    viewer: UserDocument,
    target: { assigned_admin_id?: Types.ObjectId | null },
): boolean => {
    if (viewer.role === "superadmin") return true;
    return String(target.assigned_admin_id ?? "") === String(viewer._id);
};
