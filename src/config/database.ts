import mongoose from "mongoose";

async function connectDB(): Promise<void> {
  const uri: string =
    process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("[MongoDB] Connected to", uri);
}

export default connectDB;
