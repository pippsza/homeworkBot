/**
 * Migration: rename answerViewers → reviewers in Settings collection
 * Run once: node src/migrate-reviewers.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

async function migrate() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const result = await mongoose.connection.db
    .collection("settings")
    .updateMany({}, { $rename: { answerViewers: "reviewers" } });

  console.log(`Updated ${result.modifiedCount} document(s)`);
  await mongoose.disconnect();
  console.log("Done");
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
