import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  db,
  nowIso,
  setSetting,
  type AttachmentRecord,
  type ChatMessageRecord,
  type ChatSessionRecord,
  type DiaryRecord,
  type SettingRecord,
} from "./db";

interface BackupData {
  settings: SettingRecord[];
  diaries: DiaryRecord[];
  sessions: ChatSessionRecord[];
  messages: ChatMessageRecord[];
  attachments: Array<Omit<AttachmentRecord, "blob"> & { filePath: string }>;
}

interface BackupManifest {
  format: "worldtree-diary-backup";
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  counts: Record<string, number>;
  timezone: string;
}

const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").slice(0, 120);

export async function createBackupZip() {
  const [settings, diaries, sessions, messages, attachments] = await Promise.all([
    db.settings.toArray(),
    db.diaries.toArray(),
    db.sessions.toArray(),
    db.messages.toArray(),
    db.attachments.toArray(),
  ]);

  const files: Record<string, Uint8Array> = {};
  const attachmentMeta: BackupData["attachments"] = [];
  for (const attachment of attachments) {
    const filePath = `attachments/${attachment.id}__${safeName(attachment.originalName)}`;
    files[filePath] = new Uint8Array(await attachment.blob.arrayBuffer());
    const { blob: _blob, ...metadata } = attachment;
    void _blob;
    attachmentMeta.push({ ...metadata, filePath });
  }

  const manifest: BackupManifest = {
    format: "worldtree-diary-backup",
    formatVersion: 1,
    appVersion: "0.1.0",
    exportedAt: nowIso(),
    counts: {
      diaries: diaries.length,
      sessions: sessions.length,
      messages: messages.length,
      attachments: attachments.length,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
  };
  const data: BackupData = {
    settings,
    diaries,
    sessions,
    messages,
    attachments: attachmentMeta,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["data.json"] = strToU8(JSON.stringify(data));

  return {
    blob: new Blob([zipSync(files, { level: 6 }) as BlobPart], {
      type: "application/zip",
    }),
    manifest,
  };
}

export async function downloadBackup() {
  const { blob, manifest } = await createBackupZip();
  const date = manifest.exportedAt.slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `worldtree-diary-backup-${date}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  await setSetting("lastBackupAt", manifest.exportedAt);
  return manifest;
}

export async function inspectBackup(file: File) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!archive["manifest.json"] || !archive["data.json"]) {
    throw new Error("백업에 필요한 manifest.json 또는 data.json이 없습니다.");
  }
  const manifest = JSON.parse(strFromU8(archive["manifest.json"])) as BackupManifest;
  if (manifest.format !== "worldtree-diary-backup" || manifest.formatVersion !== 1) {
    throw new Error("지원하지 않는 백업 형식입니다.");
  }
  const data = JSON.parse(strFromU8(archive["data.json"])) as BackupData;
  if (!Array.isArray(data.diaries) || !Array.isArray(data.attachments)) {
    throw new Error("백업 데이터가 손상되었습니다.");
  }
  for (const attachment of data.attachments) {
    if (!archive[attachment.filePath]) {
      throw new Error(`첨부 파일이 누락되었습니다: ${attachment.originalName}`);
    }
  }
  return { archive, manifest, data };
}

export async function restoreBackup(file: File) {
  const { archive, manifest, data } = await inspectBackup(file);
  const attachments: AttachmentRecord[] = data.attachments.map((metadata) => {
    const { filePath, ...record } = metadata;
    return {
      ...record,
      blob: new Blob([archive[filePath] as BlobPart], { type: record.mimeType }),
    };
  });

  await db.transaction(
    "rw",
    [db.settings, db.diaries, db.sessions, db.messages, db.attachments],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.diaries.clear(),
        db.sessions.clear(),
        db.messages.clear(),
        db.attachments.clear(),
      ]);
      await db.settings.bulkAdd(data.settings);
      await db.diaries.bulkAdd(data.diaries);
      await db.sessions.bulkAdd(data.sessions);
      await db.messages.bulkAdd(data.messages);
      await db.attachments.bulkAdd(attachments);
    },
  );
  return manifest;
}
