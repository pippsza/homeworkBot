import Info, { IInfo, IInfoAttachment } from "../models/Info";
import { syncInfoChunks, deleteInfoChunks } from "./infoChunkingService";

export async function getAll(): Promise<IInfo[]> {
  return Info.find().sort({ order: 1 });
}

export async function getById(id: string): Promise<IInfo | null> {
  return Info.findById(id);
}

export async function create(data: Partial<IInfo>): Promise<IInfo> {
  const count = await Info.countDocuments();
  const info = await Info.create({ ...data, order: count });
  // Chunk in background
  syncInfoChunks(info._id.toString()).catch((e: Error) =>
    console.error("[infoService] chunking error on create:", e.message)
  );
  return info;
}

export async function update(id: string, data: Partial<IInfo>): Promise<IInfo | null> {
  const info = await Info.findByIdAndUpdate(id, data, { returnDocument: "after" });
  if (info) {
    syncInfoChunks(id).catch((e: Error) =>
      console.error("[infoService] chunking error on update:", e.message)
    );
  }
  return info;
}

export async function deleteInfo(id: string): Promise<IInfo | null> {
  await deleteInfoChunks(id).catch((e: Error) =>
    console.error("[infoService] chunk deletion error:", e.message)
  );
  return Info.findByIdAndDelete(id);
}

export async function setAttachments(id: string, attachments: IInfoAttachment[]): Promise<IInfo | null> {
  const info = await Info.findByIdAndUpdate(
    id,
    { attachments },
    { returnDocument: "after" }
  );
  if (info) {
    syncInfoChunks(id).catch((e: Error) =>
      console.error("[infoService] chunking error on setAttachments:", e.message)
    );
  }
  return info;
}

export { deleteInfo as delete };
