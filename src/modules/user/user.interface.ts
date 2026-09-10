export interface UserInterface {
    _id: string,
    first_name: string,
    last_name: string,
    date_of_birth: Date,
    mobile: string,
    email: string,
    password: string,
    role: "Citizen" | "NGO" | "Admin" | "Police" | "Finder" | "Family",
    last_login: Date,
    updated_at: Date,
    created_at: Date,
}