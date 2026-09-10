
import "dotenv/config";
import mongoose from "mongoose";

const DBConnect = async()=>{
    try {
        const dbName = process.env.DB_NAME;
        const dbUrl = process.env.DB_URL;
        if(!dbName){
            console.log("Please provide database name");
            process.exit(1);
        }

        if(!dbUrl){
            console.log("Please provide database url");
            process.exit(1);
        }

        await mongoose.connect(`${dbUrl}/${dbName}`);
        console.log("Database connected successfully");
    } 
    catch (error) {
        if(error instanceof Error){
            console.log(error.message || "Something went wrong in database connection");
            process.exit(1);
        }
    }
}

export default DBConnect;
