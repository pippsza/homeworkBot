import mongoose from "mongoose";

async function connectDB(): Promise<void> {
  const uri: string =
    process.env.MONGODB_URI || "mongodb://localhost:27017/homeworkbot";
  await mongoose.connect(uri);
  // У рядку підключення живе пароль, а логи читає будь-хто з доступом
  // до сервера, тому показуємо лише хост і базу.
  console.log("[MongoDB] Connected to", uri.replace(/\/\/[^@]*@/, "//***@"));
}

export default connectDB;
