import { Schema } from "mongoose";
import { UserInterface } from "./user.interface";

const userSchema = new Schema<UserInterface>({
    first_name: {
        type: String,
        required: true,
        trime: true
    },
    last_name: {
        type: String,
        required: true,
        trime: true
    },
    date_of_birth: {
        type: Date,
        required: true
    },
    mobile: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ["Citizen", "NGO", "Admin", "Police", "Finder", "Family"],
        default: "Citizen"
    },
    last_login: {
        type: Date,
        required: true
    }
},
{
    timestamps: true
})