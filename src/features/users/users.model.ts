import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcryptjs";
import { USER_ROLES, VERIFIABLE_ROLES, type UserRole } from "../../shared/types/roles";
import { maskAadhaar } from "../../shared/validators/validators";
import type { UserInterface } from "./users.types";

export type UserDocument = HydratedDocument<UserInterface>;

const SALT_ROUNDS = 12;

const policeProfileSchema = new Schema(
    {
        rank: { type: String, trim: true },
        badge_number: { type: String, trim: true, uppercase: true },
        station_name: { type: String, trim: true },
        district: { type: String, trim: true },
        state: { type: String, trim: true },
        official_email: { type: String, trim: true, lowercase: true },
        employee_id: { type: String, trim: true, uppercase: true },
        joining_date: { type: Date },
        reporting_officer: { type: String, trim: true },
        reporting_officer_contact: { type: String, trim: true },
        id_card_files: { type: [String], default: [] },
        appointment_proof_files: { type: [String], default: [] },
    },
    { _id: false },
);

const ngoProfileSchema = new Schema(
    {
        org_name: { type: String, trim: true },
        org_type: { type: String, trim: true },
        reg_number: { type: String, trim: true },
        state: { type: String, trim: true },
        district: { type: String, trim: true },
        city: { type: String, trim: true },
        address: { type: String, trim: true },
        contact_person: { type: String, trim: true },
        designation: { type: String, trim: true },
        contact_mobile: { type: String, trim: true },
        contact_email: { type: String, trim: true, lowercase: true },
        website: { type: String, trim: true },
        contact_aadhaar: { type: String, trim: true },
        reg_certificate_files: { type: [String], default: [] },
        org_photo_files: { type: [String], default: [] },
    },
    { _id: false },
);

const verificationCallSchema = new Schema(
    {
        link: { type: String, trim: true },
        time: { type: Date },
        note: { type: String, trim: true },
        scheduled_by: { type: Schema.Types.ObjectId, ref: "User" },
        scheduled_at: { type: Date },
    },
    { _id: false },
);

/**
 * Where a police or NGO member's OTP-verified contact change waits for an admin.
 *
 * Deliberately not applied to `email`/`mobile` on save: the live values stay put
 * until `approveUser` promotes them, so a rejected request changes nothing.
 */
const pendingContactSchema = new Schema(
    {
        email: { type: String, trim: true, lowercase: true },
        mobile: { type: String, trim: true },
        email_otp_verified_at: { type: Date },
        mobile_otp_verified_at: { type: Date },
        requested_at: { type: Date, default: Date.now },
    },
    { _id: false },
);


const userSchema = new Schema<UserInterface>(
    {
        first_name: {
            type: String,
            required: [true, "First name is required."],
            trim: true,
        },
        last_name: {
            type: String,
            required: [true, "Last name is required."],
            trim: true,
        },
        aadhaar: {
            type: String,
            required: [true, "Aadhaar number is required."],
            unique: true,
            trim: true,
        },
        mobile: {
            type: String,
            required: [true, "Mobile number is required."],
            unique: true,
            trim: true,
        },
        // Optional: the public sign-up form does not collect an email. `sparse`
        // keeps the unique index from allowing only one account with no email.
        email: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true,
        },
        // Never returned unless explicitly selected with .select("+password").
        password: {
            type: String,
            required: [true, "Password is required."],
            select: false,
        },
        role: {
            type: String,
            required: true,
            enum: {
                values: USER_ROLES,
                message: "{VALUE} is not a supported role.",
            },
            default: "public",
        },
        assigned_admin_id: { type: Schema.Types.ObjectId, ref: "User" },

        police: { type: policeProfileSchema },
        ngo: { type: ngoProfileSchema },

        pending_contact: { type: pendingContactSchema },

        verification_status: {
            type: String,
            enum: {
                values: ["pending", "verified", "rejected"],
                message: "{VALUE} is not a valid verification status.",
            },
            default: "pending",
        },
        submitted_at: { type: Date, default: Date.now },
        rejection_reason: { type: String, trim: true },
        reviewed_by: { type: Schema.Types.ObjectId, ref: "User" },
        reviewed_at: { type: Date },
        verification_call: { type: verificationCallSchema },

        refresh_token_hash: { type: String, default: null, select: false },
        password_changed_at: { type: Date, select: false },
        last_login: { type: Date },

        is_active: { type: Boolean, default: true },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: Record<string, unknown>) => {
                ret.id = ret._id;
                delete ret._id;
                delete ret.__v;
                delete ret.password;
                delete ret.refresh_token_hash;
                return ret;
            },
        },
        toObject: { virtuals: true },
    },
);

userSchema.virtual("full_name").get(function (this: UserDocument): string {
    return `${this.first_name} ${this.last_name}`.trim();
});

/** Frontend shows only the last four digits once a record exists. */
userSchema.virtual("aadhaar_masked").get(function (this: UserDocument): string {
    return maskAadhaar(this.aadhaar);
});

/** Mirrors the frontend's `pickAdminForMember`: same state, then least load, then oldest. */
userSchema.index({ role: 1, is_active: 1, verification_status: 1 });
userSchema.index({ assigned_admin_id: 1, verification_status: 1 });
userSchema.index({ "police.state": 1 });
userSchema.index({ "ngo.state": 1 });

/** Finds the staff accounts with a contact change waiting for a decision. */
userSchema.index({ "pending_contact.email": 1, "pending_contact.mobile": 1 });

userSchema.pre("save", async function hashPassword(this: UserDocument) {
    if (!this.isModified("password")) return;
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    this.password_changed_at = new Date();
    // Any password change must invalidate outstanding refresh tokens.
    this.refresh_token_hash = null;
});

userSchema.pre("save", function stampSubmittedAt(this: UserDocument) {
    if (this.isNew && (VERIFIABLE_ROLES as readonly UserRole[]).includes(this.role)) {
        this.submitted_at = new Date();
    }
});

/**
 * Only police and NGO accounts sit in the admin review queue. Everyone else -
 * `public`, `admin` and the CLI-minted `superadmin` - starts out verified and
 * can sign straight in. Written as the inverse of VERIFIABLE_ROLES so a new
 * role is never left stuck at `pending` by default.
 */
userSchema.pre("validate", function defaultVerificationStatus(this: UserDocument) {
    if (!this.isNew) return;
    if (!(VERIFIABLE_ROLES as readonly UserRole[]).includes(this.role)) {
        this.verification_status = "verified";
    }
});

export const User: Model<UserInterface> = model<UserInterface>("User", userSchema);
