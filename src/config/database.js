const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("[MongoDB] Connected to", uri);
}

module.exports = connectDB;
