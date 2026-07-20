import Dexie, { type EntityTable } from "dexie";

export type ChatTone = "friendly" | "polite" | "formal";
export type WeatherKind = "clear" | "cloudy" | "rain" | "snow";
export type ProfileGender = "female" | "male" | "nonbinary" | "private";

export interface UserProfile {
  name: string;
  age?: number;
  gender?: ProfileGender;
  birthday?: string;
  updatedAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface WeatherSnapshot {
  kind: WeatherKind;
  code: number;
  temperature: number | null;
  label: string;
  location: string;
  capturedAt: string;
}

export interface DiaryRecord {
  id: string;
  date: string;
  title: string;
  content: string;
  source: "ai" | "manual";
  mood?: string;
  weather?: WeatherSnapshot;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionRecord {
  id: string;
  date: string;
  diaryId?: string;
  tone: ChatTone;
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachmentIds: string[];
  createdAt: string;
}

export interface AttachmentRecord {
  id: string;
  blob: Blob;
  originalName: string;
  mimeType: string;
  byteSize: number;
  aiReadable: boolean;
  analysisStatus: "none" | "pending" | "used" | "failed";
  createdAt: string;
}

class WorldTreeDiaryDB extends Dexie {
  settings!: EntityTable<SettingRecord, "key">;
  diaries!: EntityTable<DiaryRecord, "id">;
  sessions!: EntityTable<ChatSessionRecord, "id">;
  messages!: EntityTable<ChatMessageRecord, "id">;
  attachments!: EntityTable<AttachmentRecord, "id">;

  constructor() {
    super("worldtree-diary");
    this.version(1).stores({
      settings: "&key, updatedAt",
      diaries: "&id, &date, updatedAt, createdAt",
      sessions: "&id, date, status, updatedAt",
      messages: "&id, sessionId, createdAt",
      attachments: "&id, createdAt, analysisStatus",
    });
  }
}

export const db = new WorldTreeDiaryDB();

export const nowIso = () => new Date().toISOString();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key);
  return (record?.value as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value, updatedAt: nowIso() });
}

export function isAiReadableFile(file: Pick<File, "type" | "name">) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type.startsWith("image/") ||
    type === "application/pdf" ||
    type === "text/plain" ||
    /\.(jpe?g|png|webp|pdf|txt)$/.test(name)
  );
}

export async function saveFiles(files: File[]) {
  const created: AttachmentRecord[] = files.map((file) => ({
    id: crypto.randomUUID(),
    blob: file,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    byteSize: file.size,
    aiReadable: isAiReadableFile(file),
    analysisStatus: "none",
    createdAt: nowIso(),
  }));
  if (created.length) await db.attachments.bulkAdd(created);
  return created;
}

export async function cleanupOrphanAttachments() {
  const [diaries, messages, attachments] = await Promise.all([
    db.diaries.toArray(),
    db.messages.toArray(),
    db.attachments.toArray(),
  ]);
  const referenced = new Set<string>();
  diaries.forEach((diary) => diary.attachmentIds.forEach((id) => referenced.add(id)));
  messages.forEach((message) =>
    message.attachmentIds.forEach((id) => referenced.add(id)),
  );
  const orphanIds = attachments
    .filter((attachment) => !referenced.has(attachment.id))
    .map((attachment) => attachment.id);
  if (orphanIds.length) await db.attachments.bulkDelete(orphanIds);
}

export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0 };
  }
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}
