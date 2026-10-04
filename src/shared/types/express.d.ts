import type { UserDocument } from "../../features/users/users.model";

declare global {
    namespace Express {
        interface Request {
            user?: UserDocument;
        }
    }
}

export {};
