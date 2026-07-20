"use client";

import {
  ArchiveRestore,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudRain,
  Download,
  Eye,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Leaf,
  List,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadBackup, inspectBackup, restoreBackup } from "@/lib/backup";
import {
  cleanupOrphanAttachments,
  db,
  getSetting,
  getStorageEstimate,
  nowIso,
  requestPersistentStorage,
  saveFiles,
  setSetting,
  type AttachmentRecord,
  type ChatMessageRecord,
  type ChatSessionRecord,
  type ChatTone,
  type DiaryRecord,
  type ProfileGender,
  type UserProfile,
  type WeatherKind,
  type WeatherSnapshot,
} from "@/lib/db";

type ModalName = "keeper" | "chat" | "transcript" | "editor" | "detail" | "search" | "settings" | "profile" | null;
type ViewMode = "calendar" | "list";

interface EditorState {
  id?: string;
  date: string;
  title: string;
  content: string;
  source: "ai" | "manual";
  mood: string;
  weather?: WeatherSnapshot;
  attachmentIds: string[];
  sessionId?: string;
  createdAt?: string;
}

interface TranscriptState {
  session: ChatSessionRecord;
  messages: ChatMessageRecord[];
}

interface ProfileDraft {
  name: string;
  age: string;
  gender: ProfileGender | "";
  birthday: string;
}

const emptyProfileDraft: ProfileDraft = {
  name: "",
  age: "",
  gender: "",
  birthday: "",
};

const toneOptions: Array<{ id: ChatTone; label: string; description: string }> = [
  { id: "friendly", label: "친근하게", description: "가까운 친구처럼 편안하게" },
  { id: "polite", label: "예의바르게", description: "따뜻한 해요체로" },
  { id: "formal", label: "정중하게", description: "차분하고 절제된 존댓말로" },
];

const moodOptions = [
  { id: "warm", label: "따뜻", emoji: "☀️" },
  { id: "calm", label: "평온", emoji: "🌿" },
  { id: "tired", label: "지침", emoji: "🌙" },
  { id: "sad", label: "울적", emoji: "🌧️" },
  { id: "spark", label: "설렘", emoji: "✨" },
];

type WeatherChoice = WeatherKind | "unknown";
type IntroWeatherMode = WeatherKind | "auto";

const weatherChoiceOptions: Array<{ id: WeatherChoice; label: string; emoji: string }> = [
  { id: "unknown", label: "모름", emoji: "?" },
  { id: "clear", label: "맑음", emoji: "☀️" },
  { id: "cloudy", label: "흐림", emoji: "☁️" },
  { id: "rain", label: "비", emoji: "🌧️" },
  { id: "snow", label: "눈", emoji: "❄️" },
];

const introWeatherOptions: Array<{ id: IntroWeatherMode; label: string }> = [
  { id: "auto", label: "현재" },
  { id: "clear", label: "화창" },
  { id: "cloudy", label: "흐림" },
  { id: "rain", label: "비" },
  { id: "snow", label: "눈" },
];

const weatherLabels: Record<WeatherKind, string> = {
  clear: "맑음",
  cloudy: "흐림",
  rain: "비",
  snow: "눈",
};

const moodSearchAliases: Record<string, string[]> = {
  warm: ["따뜻", "행복", "기쁘", "좋은 기분", "포근"],
  calm: ["평온", "편안", "차분", "잔잔"],
  tired: ["지침", "지친", "피곤", "피로", "힘들"],
  sad: ["울적", "우울", "슬프", "속상"],
  spark: ["설렘", "설레", "신남", "신나", "기대"],
};

const weatherSearchAliases: Record<WeatherChoice, string[]> = {
  unknown: ["날씨 모름", "날씨를 모름", "날씨 없음", "날씨 미지정", "모름", "unknown"],
  clear: ["맑음", "맑은", "맑았", "화창", "햇살", "해가"],
  cloudy: ["흐림", "흐린", "흐렸", "구름", "cloudy"],
  rain: ["비", "비가", "비 온", "비오는", "비 오는", "장마", "rain"],
  snow: ["눈", "눈이", "눈 온", "눈오는", "눈 오는", "snow"],
};

function queryMatchesAliases(query: string, aliases: string[]) {
  const tokens = query.split(/\s+/);
  return aliases.some((alias) => alias.length === 1 ? tokens.includes(alias) : query.includes(alias));
}

function diaryTagMatches(diary: DiaryRecord, query: string) {
  const moodMatched = diary.mood
    ? queryMatchesAliases(query, moodSearchAliases[diary.mood] ?? [])
    : false;
  const weatherKey: WeatherChoice = diary.weather?.kind ?? "unknown";
  return moodMatched || queryMatchesAliases(query, weatherSearchAliases[weatherKey]);
}

interface DateQueryParts {
  year?: number;
  month?: number;
  day?: number;
}

function dateQueryParts(query: string): DateQueryParts | null {
  const iso = query.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const year = query.match(/(\d{4})\s*년/);
  const month = query.match(/(\d{1,2})\s*월/);
  const day = query.match(/(\d{1,2})\s*일/);
  if (!year && !month && !day) return null;
  return {
    year: year ? Number(year[1]) : undefined,
    month: month ? Number(month[1]) : undefined,
    day: day ? Number(day[1]) : undefined,
  };
}

function diaryMatchesDateQuery(dateKeyValue: string, parts: DateQueryParts) {
  const date = parseDateKey(dateKeyValue);
  return (
    (parts.year === undefined || date.getFullYear() === parts.year) &&
    (parts.month === undefined || date.getMonth() + 1 === parts.month) &&
    (parts.day === undefined || date.getDate() === parts.day)
  );
}

function diaryDateSearchText(dateKeyValue: string) {
  const date = parseDateKey(dateKeyValue);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${dateKeyValue} ${year}년 ${year}년 ${month}월 ${year}년 ${month}월 ${day}일 ${month}월 ${month}월의 ${month}월 ${day}일 ${day}일 ${day}일의`;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todayKey = () => dateKey(new Date());
const parseDateKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const koreanDate = (key: string, includeYear = true) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: includeYear ? "numeric" : undefined,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseDateKey(key));
const monthLabel = (date: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
const bytesLabel = (bytes: number) => {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function calendarCells(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<Date | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= lastDate; day += 1) cells.push(new Date(year, monthIndex, day));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function weatherFromCode(code: number): { kind: WeatherKind; label: string } {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { kind: "snow", label: "눈" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) {
    return { kind: "rain", label: "비" };
  }
  if ([1, 2, 3, 45, 48].includes(code)) return { kind: "cloudy", label: "흐림" };
  return { kind: "clear", label: "맑음" };
}

async function fileToInline(file: File | AttachmentRecord) {
  const blob = file instanceof File ? file : file.blob;
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < buffer.length; index += chunk) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunk));
  }
  return {
    name: file instanceof File ? file.name : file.originalName,
    mimeType: blob.type || (file instanceof File ? file.type : file.mimeType),
    data: btoa(binary),
  };
}

function WeatherIcon({ kind, size = 18 }: { kind: WeatherKind; size?: number }) {
  if (kind === "rain") return <CloudRain size={size} />;
  if (kind === "snow") return <Snowflake size={size} />;
  if (kind === "cloudy") return <Cloud size={size} />;
  return <Sun size={size} />;
}

function WeatherAtmosphere({ kind }: { kind: WeatherKind }) {
  return (
    <div className={`weather-layer weather-${kind}`} aria-hidden="true">
      {kind === "clear" && Array.from({ length: 32 }).map((_, index) => (
        <i
          className="sun-sparkle"
          key={`sparkle-${index}`}
          style={{
            left: `${(index * 37 + 8) % 96}%`,
            top: `${(index * 29 + 7) % 78}%`,
            animationDelay: `-${(index % 9) * 0.28}s`,
            animationDuration: `${1.7 + (index % 5) * 0.28}s`,
          }}
        />
      ))}
      {kind === "cloudy" && (
        <>
          <span className="cloudy-dim-layer" />
          <span className="fog-sea" />
          {Array.from({ length: 4 }).map((_, index) => (
            <i
              className="fog-current"
              key={`fog-${index}`}
              style={{
                bottom: `${-14 + (index % 2) * 5}vh`,
                animationDelay: `-${index * 5.5}s`,
                animationDuration: "22s",
              }}
            >
              <span className="fog-current-ring" />
            </i>
          ))}
        </>
      )}
      {kind === "rain" && Array.from({ length: 50 }).map((_, index) => (
        <i
          className="rain-drop"
          key={`rain-${index}`}
          style={{
            left: `${(index * 31 + 3) % 104}%`,
            height: `${58 + (index % 7) * 9}px`,
            opacity: 0.4 + (index % 5) * 0.09,
            animationDelay: `-${(index % 11) * 0.13}s`,
            animationDuration: `${0.82 + (index % 5) * 0.11}s`,
          }}
        />
      ))}
      {kind === "snow" && Array.from({ length: 32 }).map((_, index) => (
        <i
          className="snow-flake"
          key={`snow-${index}`}
          style={{
            left: `${(index * 43 + 5) % 100}%`,
            width: `${4 + (index % 4) * 1.4}px`,
            height: `${4 + (index % 4) * 1.4}px`,
            opacity: 0.42 + (index % 5) * 0.1,
            animationDelay: `-${(index % 12) * 0.65}s`,
            animationDuration: `${6.8 + (index % 7) * 0.75}s`,
          }}
        />
      ))}
    </div>
  );
}

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function Home() {
  const [entered, setEntered] = useState(false);
  const [modal, setModal] = useState<ModalName>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(emptyProfileDraft);
  const [profileEntryPending, setProfileEntryPending] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [diaries, setDiaries] = useState<DiaryRecord[]>([]);
  const [activeDiary, setActiveDiary] = useState<DiaryRecord | null>(null);
  const [activeAttachments, setActiveAttachments] = useState<AttachmentRecord[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorAttachments, setEditorAttachments] = useState<AttachmentRecord[]>([]);
  const [tone, setTone] = useState<ChatTone>("polite");
  const [session, setSession] = useState<ChatSessionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [transcript, setTranscript] = useState<TranscriptState | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<DiaryRecord[]>([]);
  const [toast, setToast] = useState("");
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persistent: false });
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [introWeatherMode, setIntroWeatherMode] = useState<IntroWeatherMode>("auto");
  const [weather, setWeather] = useState<WeatherSnapshot>({
    kind: "clear",
    code: 0,
    temperature: 24,
    label: "맑음",
    location: "서울",
    capturedAt: nowIso(),
  });

  const chatFileInput = useRef<HTMLInputElement>(null);
  const editorFileInput = useRef<HTMLInputElement>(null);
  const restoreFileInput = useRef<HTMLInputElement>(null);
  const introRestoreInput = useRef<HTMLInputElement>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const refreshDiaries = useCallback(async () => {
    const records = await db.diaries.orderBy("date").reverse().toArray();
    setDiaries(records);
    const estimate = await getStorageEstimate();
    setStorage((current) => ({ ...current, ...estimate }));
  }, []);

  const loadWeather = useCallback(async (latitude: number, longitude: number, location: string) => {
    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`,
      );
      if (!response.ok) throw new Error("날씨 요청 실패");
      const data = (await response.json()) as {
        current?: { weather_code?: number; temperature_2m?: number };
      };
      const code = Number(data.current?.weather_code ?? 0);
      const mapped = weatherFromCode(code);
      const next: WeatherSnapshot = {
        ...mapped,
        code,
        temperature: Math.round(Number(data.current?.temperature_2m ?? 24)),
        location,
        capturedAt: nowIso(),
      };
      setWeather(next);
      await setSetting("weather", next);
    } catch {
      flash("날씨를 불러오지 못해 기본 풍경을 보여드려요.");
    }
  }, [flash]);

  useEffect(() => {
    void (async () => {
      const [savedTone, savedView, savedWeather, backupAt, savedProfile, savedIntroWeatherMode, persistent] = await Promise.all([
        getSetting<ChatTone>("chatTone", "polite"),
        getSetting<ViewMode>("viewMode", "calendar"),
        getSetting<WeatherSnapshot | null>("weather", null),
        getSetting<string | null>("lastBackupAt", null),
        getSetting<UserProfile | null>("profile", null),
        getSetting<IntroWeatherMode>("introWeatherMode", "auto"),
        requestPersistentStorage(),
      ]);
      setTone(savedTone);
      setViewMode(savedView);
      if (savedWeather) setWeather(savedWeather);
      setLastBackupAt(backupAt);
      setProfile(savedProfile);
      setIntroWeatherMode(savedIntroWeatherMode);
      setStorage((current) => ({ ...current, persistent }));
      await cleanupOrphanAttachments();
      await refreshDiaries();
      await loadWeather(37.5665, 126.978, "서울");
    })();
  }, [loadWeather, refreshDiaries]);

  useEffect(() => {
    if (!editor) return;
    void (async () => {
      const records = await db.attachments.bulkGet(editor.attachmentIds);
      setEditorAttachments(records.filter(Boolean) as AttachmentRecord[]);
    })();
  }, [editor]);

  const diaryByDate = useMemo(() => new Map(diaries.map((diary) => [diary.date, diary])), [diaries]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const introWeatherKind = introWeatherMode === "auto" ? weather.kind : introWeatherMode;

  const changeIntroWeatherMode = async (mode: IntroWeatherMode) => {
    setIntroWeatherMode(mode);
    await setSetting("introWeatherMode", mode);
  };

  const openProfile = (enterAfterSave = false) => {
    setProfileDraft(profile ? {
      name: profile.name,
      age: profile.age ? String(profile.age) : "",
      gender: profile.gender ?? "",
      birthday: profile.birthday ?? "",
    } : { ...emptyProfileDraft });
    setProfileEntryPending(enterAfterSave);
    setModal("profile");
  };

  const saveProfile = async () => {
    const name = profileDraft.name.trim().slice(0, 20);
    if (!name) {
      flash("모아가 불러드릴 이름을 적어주세요.");
      return;
    }
    const parsedAge = profileDraft.age ? Number(profileDraft.age) : undefined;
    if (parsedAge !== undefined && (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120)) {
      flash("나이는 1세부터 120세 사이로 적어주세요.");
      return;
    }
    const next: UserProfile = {
      name,
      age: parsedAge,
      gender: profileDraft.gender || undefined,
      birthday: profileDraft.birthday || undefined,
      updatedAt: nowIso(),
    };
    await setSetting("profile", next);
    setProfile(next);
    setModal(null);
    if (profileEntryPending) {
      setEntered(true);
      await requestPersistentStorage();
    }
    setProfileEntryPending(false);
    flash(profile ? "프로필을 수정했어요." : `${name}님의 서재를 만들었어요.`);
  };

  const enterLibrary = async () => {
    if (!profile) {
      openProfile(true);
      return;
    }
    setEntered(true);
    await requestPersistentStorage();
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      flash("이 브라우저에서는 위치 기능을 사용할 수 없어요.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadWeather(position.coords.latitude, position.coords.longitude, "현재 위치");
        flash("현재 위치의 날씨를 불러왔어요.");
      },
      () => flash("위치 권한이 없어 서울 날씨를 유지해요."),
      { timeout: 8000 },
    );
  };

  const changeView = async (mode: ViewMode) => {
    setViewMode(mode);
    await setSetting("viewMode", mode);
  };

  const openEditor = async (date: string, source: "manual" | "ai" = "manual", draft?: Partial<EditorState>) => {
    const existing = await db.diaries.where("date").equals(date).first();
    const defaultWeather = date === todayKey() ? weather : undefined;
    setSelectedDate(date);
    setEditor({
      id: existing?.id,
      date,
      title: existing?.title ?? draft?.title ?? "",
      content: existing?.content ?? draft?.content ?? "",
      source: existing?.source ?? source,
      mood: existing?.mood ?? draft?.mood ?? "calm",
      weather: existing?.weather ?? draft?.weather ?? defaultWeather,
      attachmentIds: existing?.attachmentIds ?? draft?.attachmentIds ?? [],
      sessionId: draft?.sessionId,
      createdAt: existing?.createdAt,
    });
    setModal("editor");
  };

  const saveDiary = async () => {
    if (!editor) return;
    if (!editor.content.trim()) {
      flash("한 줄이라도 오늘의 이야기를 남겨주세요.");
      return;
    }
    const id = editor.id ?? crypto.randomUUID();
    const record: DiaryRecord = {
      id,
      date: editor.date,
      title: editor.title.trim() || `${koreanDate(editor.date, false)}의 기록`,
      content: editor.content.trim(),
      source: editor.source,
      mood: editor.mood,
      weather: editor.weather,
      attachmentIds: editor.attachmentIds,
      createdAt: editor.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    await db.diaries.put(record);
    if (editor.sessionId) {
      await db.sessions.update(editor.sessionId, { diaryId: id, status: "completed", updatedAt: nowIso() });
    }
    await refreshDiaries();
    setActiveDiary(record);
    setActiveAttachments(editorAttachments);
    setModal("detail");
    flash("오늘의 기억을 서재에 꽂아두었어요.");
  };

  const addEditorFiles = async (files: File[]) => {
    if (!editor || !files.length) return;
    const available = Math.max(0, 5 - editor.attachmentIds.length);
    const accepted = files.filter((file) => file.size <= 10 * 1024 * 1024).slice(0, available);
    if (accepted.length !== files.length) flash("파일은 10MB 이하, 일기당 5개까지 보관할 수 있어요.");
    const records = await saveFiles(accepted);
    setEditor({ ...editor, attachmentIds: [...editor.attachmentIds, ...records.map((record) => record.id)] });
  };

  const changeEditorWeather = (choice: WeatherChoice) => {
    if (!editor) return;
    if (choice === "unknown") {
      setEditor({ ...editor, weather: undefined });
      return;
    }

    const currentWeatherMatches = editor.date === todayKey() && weather.kind === choice;
    setEditor({
      ...editor,
      weather: currentWeatherMatches
        ? weather
        : {
            kind: choice,
            code: -1,
            temperature: null,
            label: weatherLabels[choice],
            location: "사용자 지정",
            capturedAt: nowIso(),
          },
    });
  };

  const removeEditorAttachment = async (id: string) => {
    if (!editor) return;
    setEditor({ ...editor, attachmentIds: editor.attachmentIds.filter((item) => item !== id) });
  };

  const openDiary = async (diary: DiaryRecord) => {
    const records = await db.attachments.bulkGet(diary.attachmentIds);
    setActiveDiary(diary);
    setActiveAttachments(records.filter(Boolean) as AttachmentRecord[]);
    setSelectedDate(diary.date);
    setModal("detail");
  };

  const deleteDiary = async () => {
    if (!activeDiary || !window.confirm("이 일기를 서재에서 꺼낼까요? 삭제 후에는 백업 없이는 되돌릴 수 없어요.")) return;
    await db.diaries.delete(activeDiary.id);
    await cleanupOrphanAttachments();
    await refreshDiaries();
    setModal(null);
    setActiveDiary(null);
    flash("일기를 삭제했어요.");
  };

  const startChat = async (date: string) => {
    let active = await db.sessions
      .where("date")
      .equals(date)
      .filter((item) => item.status === "active")
      .first();
    if (!active) {
      active = {
        id: crypto.randomUUID(),
        date,
        tone,
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await db.sessions.add(active);
    }
    const storedMessages = await db.messages.where("sessionId").equals(active.id).sortBy("createdAt");
    setSelectedDate(date);
    setSession(active);
    setTone(active.tone);
    setMessages(storedMessages);
    setPendingFiles([]);
    setModal("chat");
  };

  const openTranscript = async (diary: DiaryRecord) => {
    let storedSession = await db.sessions
      .filter((item) => item.diaryId === diary.id && item.status === "completed")
      .first();

    if (!storedSession) {
      const sameDateSessions = await db.sessions
        .where("date")
        .equals(diary.date)
        .filter((item) => item.status === "completed")
        .toArray();
      storedSession = sameDateSessions.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0];
    }

    if (!storedSession) {
      flash("이 일기에는 저장된 대화 기록이 없어요.");
      return;
    }

    const storedMessages = await db.messages
      .where("sessionId")
      .equals(storedSession.id)
      .sortBy("createdAt");
    const textMessages = storedMessages.filter(
      (message) => message.role === "user" || message.role === "assistant",
    );

    if (!textMessages.length) {
      flash("이 일기에는 남아 있는 대화 텍스트가 없어요.");
      return;
    }

    setTranscript({ session: storedSession, messages: textMessages });
    setModal("transcript");
  };

  const changeTone = async (next: ChatTone) => {
    setTone(next);
    await setSetting("chatTone", next);
    if (session) {
      const updated = { ...session, tone: next, updatedAt: nowIso() };
      setSession(updated);
      await db.sessions.put(updated);
    }
  };

  const sendChat = async () => {
    if (!session || chatBusy || (!chatInput.trim() && !pendingFiles.length)) return;
    const text = chatInput.trim() || "이 첨부물을 오늘의 기억으로 남기고 싶어요.";
    const files = pendingFiles.slice(0, 5).filter((file) => file.size <= 10 * 1024 * 1024);
    setChatInput("");
    setPendingFiles([]);
    setChatBusy(true);

    const attachmentRecords = await saveFiles(files);
    const userMessage: ChatMessageRecord = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      role: "user",
      content: text,
      attachmentIds: attachmentRecords.map((item) => item.id),
      createdAt: nowIso(),
    };
    await db.messages.add(userMessage);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);

    const crisis = /(죽고 싶|자살|해치고 싶|살기 싫|끝내고 싶)/.test(text);
    if (crisis) {
      const safeMessage: ChatMessageRecord = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: "assistant",
        content:
          "지금은 일기보다 당신의 안전이 먼저예요. 혼자 견디지 말고 가까운 사람에게 바로 알려주세요. 한국에서는 24시간 자살예방 상담전화 109, 즉각적인 위험이 있다면 112 또는 119에 연락할 수 있어요.",
        attachmentIds: [],
        createdAt: nowIso(),
      };
      await db.messages.add(safeMessage);
      setMessages([...nextMessages, safeMessage]);
      setChatBusy(false);
      return;
    }

    try {
      const inlineFiles = await Promise.all(
        files.filter((file) => /^(image\/|application\/pdf|text\/plain)/.test(file.type)).map(fileToInline),
      );
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          tone,
          date: session.date,
          message: text,
          history: messages.map(({ role, content }) => ({ role, content })),
          attachments: inlineFiles,
          profile,
        }),
      });
      const result = (await response.json()) as {
        reply?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "AI 응답 오류");
      const assistantMessage: ChatMessageRecord = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: "assistant",
        content: result.reply ?? "조금 더 들려주실래요? 오늘의 장면을 함께 천천히 바라보고 싶어요.",
        attachmentIds: [],
        createdAt: nowIso(),
      };
      await db.messages.add(assistantMessage);
      if (attachmentRecords.length) {
        await Promise.all(
          attachmentRecords.map((item) =>
            db.attachments.update(item.id, { analysisStatus: item.aiReadable ? "used" : "none" }),
          ),
        );
      }
      setMessages([...nextMessages, assistantMessage]);
    } catch {
      flash("대화 연결이 잠시 쉬고 있어요. 입력한 이야기는 안전하게 남겨두었어요.");
    } finally {
      setChatBusy(false);
    }
  };

  const generateDraft = async () => {
    if (!session || !messages.some((item) => item.role === "user")) {
      flash("먼저 오늘의 이야기를 한두 마디 들려주세요.");
      return;
    }
    setDraftBusy(true);
    try {
      const ids = [...new Set(messages.flatMap((message) => message.attachmentIds))];
      const stored = (await db.attachments.bulkGet(ids)).filter(Boolean) as AttachmentRecord[];
      const readable = stored.filter((item) => item.aiReadable).slice(0, 5);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "draft",
          tone,
          date: session.date,
          history: messages.map(({ role, content }) => ({ role, content })),
          attachments: await Promise.all(readable.map(fileToInline)),
          profile,
        }),
      });
      const result = (await response.json()) as {
        draft?: { title?: string; content?: string; mood?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "초안 생성 오류");
      if (!result.draft?.content) throw new Error("초안 내용이 비어 있습니다.");
      await openEditor(session.date, "ai", {
        title: result.draft.title ?? "오늘의 작은 기록",
        content: result.draft.content,
        mood: result.draft.mood || "calm",
        attachmentIds: ids,
        sessionId: session.id,
      });
    } catch {
      flash("초안을 만들지 못했어요. 대화는 그대로 보관되어 있어요.");
    } finally {
      setDraftBusy(false);
    }
  };

  const runSearch = async () => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      setSearchResults(diaries);
      return;
    }
    const stopWords = new Set(["일기", "기록", "찾아줘", "보여줘", "했던", "그날", "언제", "기분", "기분이", "날씨", "날"]);
    const terms = query.split(/\s+/).filter((term) => term.length > 1 && !stopWords.has(term));
    const allMessages = await db.messages.toArray();
    const sessions = await db.sessions.toArray();
    const sessionDate = new Map(sessions.map((item) => [item.id, item.date]));
    const chatByDate = new Map<string, string>();
    allMessages.forEach((message) => {
      const date = sessionDate.get(message.sessionId);
      if (date) chatByDate.set(date, `${chatByDate.get(date) ?? ""} ${message.content}`.toLowerCase());
    });
    const requestedDate = dateQueryParts(query);
    const matches = diaries.filter((diary) => {
      if (requestedDate && !diaryMatchesDateQuery(diary.date, requestedDate)) return false;
      const mood = diary.mood ? moodOptions.find((item) => item.id === diary.mood) : undefined;
      const weatherText = diary.weather ? weatherLabels[diary.weather.kind] : "날씨 모름";
      const haystack = `${diaryDateSearchText(diary.date)} ${diary.title} ${diary.content} ${chatByDate.get(diary.date) ?? ""} ${mood?.label ?? ""} ${mood?.emoji ?? ""} ${weatherText}`.toLowerCase();
      const textMatched = terms.length ? terms.some((term) => haystack.includes(term)) : haystack.includes(query);
      return textMatched || diaryTagMatches(diary, query);
    });
    setSearchResults(matches);
  };

  const handleBackup = async () => {
    const manifest = await downloadBackup();
    setLastBackupAt(manifest.exportedAt);
    flash(`${manifest.counts.diaries}개의 일기를 백업했어요.`);
  };

  const handleRestore = async (file?: File) => {
    if (!file) return;
    try {
      const inspected = await inspectBackup(file);
      const count = inspected.manifest.counts.diaries ?? 0;
      if (!window.confirm(`${count}개의 일기를 복원합니다. 현재 기록은 전체 교체됩니다. 계속할까요?`)) return;
      if (diaries.length) await downloadBackup();
      await restoreBackup(file);
      await refreshDiaries();
      const [restoredBackupAt, restoredProfile] = await Promise.all([
        getSetting<string | null>("lastBackupAt", null),
        getSetting<UserProfile | null>("profile", null),
      ]);
      setLastBackupAt(restoredBackupAt);
      setProfile(restoredProfile);
      if (restoredProfile) {
        setModal(null);
        setEntered(true);
      } else {
        setEntered(false);
        setProfileDraft({ ...emptyProfileDraft });
        setProfileEntryPending(true);
        setModal("profile");
      }
      flash("백업 속 기억을 모두 복원했어요.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "백업을 복원하지 못했어요.");
    }
  };

  const clearAllData = async () => {
    if (!window.confirm("이 브라우저의 모든 일기, 대화, 첨부물을 삭제할까요? 먼저 백업했는지 확인해 주세요.")) return;
    if (!window.confirm("정말 모두 삭제할까요? 이 작업은 되돌릴 수 없어요.")) return;
    await db.delete();
    window.location.reload();
  };

  const showSettings = async () => {
    const [estimate, backupAt] = await Promise.all([
      getStorageEstimate(),
      getSetting<string | null>("lastBackupAt", null),
    ]);
    setStorage((current) => ({ ...current, ...estimate }));
    setLastBackupAt(backupAt);
    setModal("settings");
  };

  const profileModal = modal === "profile" && (
    <ModalShell
      title={profile ? "내 프로필 다듬기" : "나만의 프로필 만들기"}
      eyebrow="LOCAL PROFILE"
      onClose={() => {
        setModal(null);
        setProfileEntryPending(false);
      }}
    >
      <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
        <div className="profile-welcome">
          <span className="profile-avatar"><UserRound size={27} /></span>
          <div>
            <b>모아가 어떻게 불러드리면 될까요?</b>
            <p>이름은 대화 중 자연스러운 호칭으로 사용돼요.</p>
          </div>
        </div>
        <label className="profile-field profile-name-field">
          <span>이름 <em>필수</em></span>
          <input
            value={profileDraft.name}
            onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))}
            maxLength={20}
            placeholder="예: 하늘"
            autoFocus
            required
          />
        </label>
        <div className="profile-field-grid">
          <label className="profile-field">
            <span>나이 <small>선택</small></span>
            <input
              type="number"
              min="1"
              max="120"
              inputMode="numeric"
              value={profileDraft.age}
              onChange={(event) => setProfileDraft((current) => ({ ...current, age: event.target.value }))}
              placeholder="예: 24"
            />
          </label>
          <label className="profile-field">
            <span>성별 <small>선택</small></span>
            <select
              value={profileDraft.gender}
              onChange={(event) => setProfileDraft((current) => ({ ...current, gender: event.target.value as ProfileDraft["gender"] }))}
            >
              <option value="">선택하지 않음</option>
              <option value="female">여성</option>
              <option value="male">남성</option>
              <option value="nonbinary">기타 / 논바이너리</option>
              <option value="private">공개하지 않음</option>
            </select>
          </label>
        </div>
        <label className="profile-field">
          <span>생일 <small>선택</small></span>
          <input
            type="date"
            max={todayKey()}
            value={profileDraft.birthday}
            onChange={(event) => setProfileDraft((current) => ({ ...current, birthday: event.target.value }))}
          />
        </label>
        <p className="profile-local-note"><HardDrive size={14} /> 실제 계정 인증이 아닌 로컬 프로필이며, 입력한 정보는 이 브라우저와 백업 파일에만 저장돼요.</p>
        <button className="primary-button full profile-submit" type="submit">
          {profileEntryPending ? "내 서재로 들어가기" : "프로필 저장하기"} <ChevronRight size={17} />
        </button>
      </form>
    </ModalShell>
  );

  if (!entered) {
    return (
      <>
      <main className="intro-screen">
        <div className="worldtree-backdrop" />
        <WeatherAtmosphere kind={introWeatherKind} />
        <div className="intro-vignette" />
        <section className="intro-content">
          <div className="brand-mark"><Leaf size={20} /><span>나무의 서재</span></div>
          <p className="intro-kicker">평범한 하루도 사라지지 않도록</p>
          <h1>오늘의 작은 장면을<br />한 권의 기억으로.</h1>
          <p className="intro-copy">서재지기 모아와 천천히 이야기를 나누거나,<br />당신의 방식대로 직접 적어도 좋아요.</p>
          <div className="intro-actions">
            <button className="primary-button large" onClick={() => void enterLibrary()}>
              {profile ? `${profile.name}님의 서재 들어가기` : "프로필 만들고 들어가기"} <ChevronRight size={18} />
            </button>
            <button className="ghost-button" onClick={() => introRestoreInput.current?.click()}>
              <ArchiveRestore size={17} /> 백업에서 복원하기
            </button>
            <input
              ref={introRestoreInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => void handleRestore(event.target.files?.[0])}
            />
          </div>
          <div className="local-note"><HardDrive size={15} /> 프로필과 기록은 이 브라우저 안에만 조용히 보관돼요.</div>
        </section>
        <div className="intro-weather">
          <div className="intro-weather-current"><WeatherIcon kind={weather.kind} /><span>{weather.location} · {weather.label} {weather.temperature}°</span></div>
          <div className="intro-effect-picker" aria-label="시작 화면 날씨 효과">
            <small>배경 효과</small>
            {introWeatherOptions.map((option) => (
              <button
                key={option.id}
                className={introWeatherMode === option.id ? "active" : ""}
                onClick={() => void changeIntroWeatherMode(option.id)}
                title={option.id === "auto" ? "현재 날씨에 맞추기" : `${option.label} 효과 보기`}
              >
                {option.id === "auto" ? <MapPin size={13} /> : <WeatherIcon kind={option.id} size={14} />}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
      {profileModal}
      {toast && <div className="toast"><Leaf size={16} />{toast}</div>}
      </>
    );
  }

  return (
    <main className={`app-shell weather-state-${weather.kind}`}>
      <div className="worldtree-backdrop app-backdrop" />
      <div className="app-overlay" />

      <header className="topbar">
        <button className="brand-button" onClick={() => setEntered(false)} aria-label="시작 화면으로">
          <span className="brand-icon"><Leaf size={18} /></span>
          <span><b>나무의 서재</b><small>WORLD TREE DIARY</small></span>
        </button>
        <div className="topbar-actions">
          <button className="weather-pill" onClick={useCurrentLocation} title="내 위치 날씨 사용">
            <WeatherIcon kind={weather.kind} />
            <span><b>{weather.temperature}°</b>{weather.location} · {weather.label}</span>
            <MapPin size={13} />
          </button>
          <button className="profile-pill" onClick={() => openProfile(false)} title="내 프로필 수정">
            <span><UserRound size={15} /></span>
            <b>{profile?.name ?? "프로필"}</b>
          </button>
          <button className="local-pill" onClick={() => void showSettings()}>
            <ShieldCheck size={16} /> 로컬 보관 중
          </button>
          <button className="icon-button glass" onClick={() => void showSettings()} aria-label="설정">
            <Settings size={19} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="day-panel glass-panel">
          <p className="eyebrow">TODAY&apos;S MEMORY</p>
          <div className="today-number">{new Date().getDate()}</div>
          <h2>{new Intl.DateTimeFormat("ko-KR", { month: "long", weekday: "long" }).format(new Date())}</h2>
          <p className="day-quote">“특별하지 않아 보여도<br />오늘만의 빛은 있었어요.”</p>
          <div className="today-status">
            {diaryByDate.has(todayKey()) ? <><Leaf size={17} /> 오늘의 기록이 자랐어요</> : <><Sparkles size={17} /> 아직 비어 있는 페이지</>}
          </div>
          <button className="primary-button full" onClick={() => void startChat(todayKey())}>
            <MessageCircle size={18} /> 모아와 오늘 이야기하기
          </button>
          <button className="soft-button full" onClick={() => void openEditor(todayKey())}>
            <PenLine size={17} /> 직접 일기 쓰기
          </button>
          <div className="mini-stats">
            <div><span>{diaries.length}</span><small>모인 기억</small></div>
            <div><span>{new Set(diaries.map((item) => item.date.slice(0, 7))).size}</span><small>함께한 달</small></div>
          </div>
        </aside>

        <section className="library-panel glass-panel">
          <div className="library-heading">
            <div>
              <p className="eyebrow">MY MEMORY SHELF</p>
              <div className="month-navigation">
                <button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="이전 달">
                  <ChevronLeft size={20} />
                </button>
                <h1>{monthLabel(month)}</h1>
                <button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달">
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            <div className="view-switch" aria-label="보기 방식">
              <button className={viewMode === "calendar" ? "active" : ""} onClick={() => void changeView("calendar")}><CalendarDays size={16} /> 달력</button>
              <button className={viewMode === "list" ? "active" : ""} onClick={() => void changeView("list")}><List size={16} /> 목록</button>
            </div>
          </div>

          {viewMode === "calendar" ? (
            <div className="calendar-wrap">
              <div className="week-row">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="calendar-grid">
                {cells.map((cell, index) => {
                  if (!cell) return <div className="calendar-empty" key={`empty-${index}`} />;
                  const key = dateKey(cell);
                  const diary = diaryByDate.get(key);
                  const isToday = key === todayKey();
                  const isSelected = key === selectedDate;
                  const mood = diary?.mood
                    ? moodOptions.find((item) => item.id === diary.mood)
                    : undefined;
                  return (
                    <button
                      key={key}
                      className={`calendar-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${diary ? "has-diary" : ""}`}
                      onClick={() => {
                        setSelectedDate(key);
                        if (diary) void openDiary(diary);
                      }}
                      onDoubleClick={() => void openEditor(key)}
                    >
                      <span className="day-number">{cell.getDate()}</span>
                      {diary ? (
                        <span className="diary-glimpse">
                          {mood && <span className="diary-mood-icon" title={`기분: ${mood.label}`} aria-hidden="true">{mood.emoji}</span>}
                          {diary.weather && <WeatherIcon kind={diary.weather.kind} size={12} />}
                          <span className="diary-glimpse-title">{diary.title}</span>
                        </span>
                      ) : isToday ? (
                        <span className="diary-glimpse empty-glimpse">오늘</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <footer className="calendar-footer">
                <span><i className="legend-dot filled" /> 기록이 있는 날</span>
                <span><i className="legend-dot today-dot" /> 오늘</span>
              </footer>
            </div>
          ) : (
            <div className="diary-list">
              {diaries.length ? diaries.map((diary) => (
                <button className="diary-list-card" key={diary.id} onClick={() => void openDiary(diary)}>
                  <div className="list-date"><b>{parseDateKey(diary.date).getDate()}</b><span>{new Intl.DateTimeFormat("ko-KR", { month: "short" }).format(parseDateKey(diary.date))}</span></div>
                  <div className="list-copy"><span>{diary.source === "ai" ? "모아와 쓴 일기" : "직접 쓴 일기"}</span><h3>{diary.title}</h3><p>{diary.content}</p></div>
                  <div className="list-meta">{diary.mood && moodOptions.find((item) => item.id === diary.mood)?.emoji}<Eye size={16} /></div>
                </button>
              )) : <div className="empty-state"><BookOpen size={34} /><h3>아직 꽂힌 일기가 없어요</h3><p>오늘의 작은 장면부터 천천히 남겨보세요.</p></div>}
            </div>
          )}
        </section>
      </section>

      <button className="keeper-button" onClick={() => setModal("keeper")} aria-label="서재지기 모아 열기">
        <span className="keeper-spark one" /><span className="keeper-spark two" />
        <span className="keeper-avatar"><Leaf size={28} /><i className="eye left" /><i className="eye right" /></span>
        <span className="keeper-label"><small>서재지기</small><b>모아</b></span>
        <span className="keeper-bubble">무엇을 도와드릴까요?</span>
      </button>

      {modal === "keeper" && (
        <ModalShell title="모아에게 맡겨주세요" eyebrow="LIBRARIAN MOA" onClose={() => setModal(null)}>
          <p className="modal-intro">오늘의 이야기를 나누거나, 기억 서랍에서 지난 장면을 함께 찾아볼 수 있어요.</p>
          <div className="keeper-menu">
            <button onClick={() => void startChat(todayKey())}><span className="menu-icon amber"><MessageCircle /></span><span><b>오늘의 일기 쓰기</b><small>대화를 나누고 한 편의 일기로 정리해요</small></span><ChevronRight /></button>
            <button onClick={() => { setSearchText(""); setSearchResults(diaries); setModal("search"); }}><span className="menu-icon green"><Search /></span><span><b>지난 기억 찾아보기</b><small>날짜나 내용으로 기억을 찾아드려요</small></span><ChevronRight /></button>
            <button onClick={() => void openEditor(selectedDate)}><span className="menu-icon cream"><PenLine /></span><span><b>지난 날짜 일기 추가</b><small>선택한 날짜에 직접 기록을 남겨요</small></span><ChevronRight /></button>
          </div>
        </ModalShell>
      )}

      {modal === "chat" && session && (
        <ModalShell title="모아와 이야기하기" eyebrow={koreanDate(session.date)} onClose={() => setModal(null)} wide>
          <div className="tone-bar">
            <span>대화 말투</span>
            <div>{toneOptions.map((option) => <button key={option.id} className={tone === option.id ? "active" : ""} onClick={() => void changeTone(option.id)} title={option.description}>{option.label}</button>)}</div>
          </div>
          <div className="chat-window">
            {!messages.length && (
              <div className="chat-message assistant"><span className="tiny-avatar"><Leaf size={15} /></span><p>{tone === "friendly" ? "오늘 하루는 어땠어? 가장 먼저 떠오르는 장면부터 들려줄래?" : tone === "formal" ? "오늘 하루 중 가장 기억에 남는 장면을 말씀해 주시겠어요?" : "오늘 하루는 어땠어요? 가장 먼저 떠오르는 장면부터 들려주실래요?"}</p></div>
            )}
            {messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="tiny-avatar"><Leaf size={15} /></span>}
                <div>
                  <p>{message.content}</p>
                  {message.attachmentIds.length > 0 && <ChatAttachmentGallery attachmentIds={message.attachmentIds} />}
                  {message.attachmentIds.length > 0 && message.role === "user" && <small><ImageIcon size={13} /> 첨부물 {message.attachmentIds.length}개 · AI가 읽도록 전송됨</small>}
                </div>
              </div>
            ))}
            {chatBusy && <div className="chat-message assistant"><span className="tiny-avatar"><Leaf size={15} /></span><p className="typing"><i /><i /><i /></p></div>}
          </div>
          {pendingFiles.length > 0 && <div className="pending-files">{pendingFiles.map((file, index) => <PendingAttachmentPreview key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={() => setPendingFiles(pendingFiles.filter((_, item) => item !== index))} />)}</div>}
          <div className="chat-composer">
            <button className="icon-button" onClick={() => chatFileInput.current?.click()} aria-label="파일 첨부"><Upload size={19} /></button>
            <input ref={chatFileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []).slice(0, 5))} />
            <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder="오늘 있었던 작은 일을 들려주세요…" rows={2} />
            <button className="send-button" onClick={() => void sendChat()} disabled={chatBusy}><Send size={18} /></button>
          </div>
          <div className="chat-footer">
            <span><ShieldCheck size={14} /> 대화와 파일은 이 브라우저에 저장돼요. AI 전송 내용은 Google에서 처리됩니다.</span>
            <button className="primary-button" onClick={() => void generateDraft()} disabled={draftBusy}>{draftBusy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} 오늘은 여기까지, 일기로 정리해줘</button>
          </div>
        </ModalShell>
      )}

      {modal === "transcript" && transcript && (
        <ModalShell
          title="이 날의 대화"
          eyebrow={koreanDate(transcript.session.date)}
          onClose={() => setModal("detail")}
          wide
        >
          <div className="transcript-note">
            <BookOpen size={17} />
            <span>이 일기를 만들 때 나눈 대화예요. 저장된 텍스트만 읽을 수 있어요.</span>
          </div>
          <div className="chat-window transcript-window">
            {transcript.messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="tiny-avatar"><Leaf size={15} /></span>}
                <div><p>{message.content}</p></div>
              </div>
            ))}
          </div>
          <div className="transcript-footer">
            <span><ShieldCheck size={14} /> 이 기록은 현재 브라우저의 로컬 서재에 보관되어 있어요.</span>
            <button className="soft-button" onClick={() => setModal("detail")}><ChevronLeft size={16} /> 일기로 돌아가기</button>
          </div>
        </ModalShell>
      )}

      {modal === "editor" && editor && (
        <ModalShell title={editor.id ? "일기 다듬기" : "새로운 기억 적기"} eyebrow={koreanDate(editor.date)} onClose={() => setModal(null)} wide>
          <div className="editor-layout">
            <div className="paper-editor">
              <input className="title-input" value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} placeholder="오늘의 제목" />
              <textarea className="content-input" value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} placeholder="오늘 있었던 일과 마음을 자유롭게 적어보세요." />
            </div>
            <aside className="editor-aside">
              <div className="field-group"><label>오늘의 기분</label><div className="mood-grid">{moodOptions.map((item) => <button key={item.id} className={editor.mood === item.id ? "active" : ""} onClick={() => setEditor({ ...editor, mood: item.id })}><span>{item.emoji}</span>{item.label}</button>)}</div></div>
              <div className="field-group"><label>함께 보관할 것</label><button className="upload-zone" onClick={() => editorFileInput.current?.click()}><Upload size={20} /><span>사진이나 파일 추가</span><small>최대 10MB · 5개</small></button><input ref={editorFileInput} type="file" multiple hidden onChange={(event) => void addEditorFiles(Array.from(event.target.files ?? []))} /></div>
              <div className="attachment-list">{editorAttachments.map((attachment) => <div key={attachment.id}><AttachmentThumbnail attachment={attachment} /><p><b>{attachment.originalName}</b><small>{bytesLabel(attachment.byteSize)}{attachment.analysisStatus === "used" ? " · AI 반영됨" : ""}</small></p><button onClick={() => void removeEditorAttachment(attachment.id)} aria-label={`${attachment.originalName} 제거`}><X size={15} /></button></div>)}</div>
              <div className="field-group weather-field"><label>이 날의 날씨</label><div className="weather-choice-grid">{weatherChoiceOptions.map((option) => <button type="button" key={option.id} className={(option.id === "unknown" ? !editor.weather : editor.weather?.kind === option.id) ? "active" : ""} onClick={() => changeEditorWeather(option.id)}><span>{option.emoji}</span>{option.label}</button>)}</div><p className="weather-choice-help">{editor.date === todayKey() ? "현재 날씨가 기본으로 저장돼요. 필요하면 바꿀 수 있어요." : "과거 날짜는 날씨 모름이 기본이에요. 기억난다면 직접 선택해 주세요."}</p></div>
            </aside>
          </div>
          <div className="editor-footer"><span>{editor.source === "ai" ? <><Sparkles size={14} /> 모아가 만든 초안을 자유롭게 고쳐주세요.</> : "당신의 문장 그대로 보관할게요."}</span><div><button className="soft-button" onClick={() => setModal(null)}>취소</button><button className="primary-button" onClick={() => void saveDiary()}><Save size={17} /> 서재에 보관하기</button></div></div>
        </ModalShell>
      )}

      {modal === "detail" && activeDiary && (
        <ModalShell title={activeDiary.title} eyebrow={koreanDate(activeDiary.date)} onClose={() => setModal(null)} wide>
          <article className="diary-detail">
            <div className="detail-meta"><span>{moodOptions.find((item) => item.id === activeDiary.mood)?.emoji ?? "🌿"} {moodOptions.find((item) => item.id === activeDiary.mood)?.label ?? "기록"}</span>{activeDiary.weather ? <span><WeatherIcon kind={activeDiary.weather.kind} size={15} /> {activeDiary.weather.location} · {activeDiary.weather.label}{activeDiary.weather.temperature !== null ? ` ${activeDiary.weather.temperature}°` : ""}</span> : <span><Cloud size={15} /> 날씨 모름</span>}<span>{activeDiary.source === "ai" ? "모아와 함께 씀" : "직접 씀"}</span></div>
            <p className="detail-content">{activeDiary.content}</p>
            {activeAttachments.length > 0 && <div className="detail-attachments"><h3>함께 보관한 조각</h3><div>{activeAttachments.map((attachment) => <AttachmentPreview attachment={attachment} key={attachment.id} />)}</div></div>}
          </article>
          <div className="detail-footer"><button className="danger-button" onClick={() => void deleteDiary()}><Trash2 size={16} /> 삭제</button><div><button className="soft-button" onClick={() => void openTranscript(activeDiary)}><MessageCircle size={16} /> 이 날의 대화</button><button className="primary-button" onClick={() => void openEditor(activeDiary.date)}><PenLine size={16} /> 수정하기</button></div></div>
        </ModalShell>
      )}

      {modal === "search" && (
        <ModalShell title="기억 서랍 찾아보기" eyebrow="MEMORY SEARCH" onClose={() => setModal(null)} wide>
          <div className="search-box"><Search size={20} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }} placeholder="예: 울적했던 날, 비 오는 날, 벚꽃을 본 날" /><button onClick={() => void runSearch()}>찾기</button></div>
          <p className="search-hint">날짜와 제목, 일기 본문, 대화뿐 아니라 그날의 기분과 날씨에서도 기억을 찾아요.</p>
          <div className="search-results">
            {searchResults.length ? searchResults.map((diary) => <button key={diary.id} onClick={() => void openDiary(diary)}><span className="result-date">{koreanDate(diary.date, false)}</span><div><h3>{diary.title}</h3><p>{diary.content}</p></div><ChevronRight size={18} /></button>) : <div className="empty-state compact"><Search size={30} /><h3>찾은 기억이 없어요</h3><p>다른 날짜나 단어로 다시 찾아볼까요?</p></div>}
          </div>
        </ModalShell>
      )}

      {modal === "settings" && (
        <ModalShell title="서재 설정" eyebrow="LOCAL LIBRARY" onClose={() => setModal(null)}>
          <div className="settings-list">
            <section><div className="setting-heading"><span className="menu-icon cream"><UserRound /></span><div><b>{profile?.name ?? "내 프로필"}</b><small>{profile ? "모아가 대화할 때 이 이름으로 불러드려요" : "대화에서 사용할 이름을 설정해 주세요"}</small></div></div><button className="soft-button profile-setting-button" onClick={() => openProfile(false)}><UserRound size={15} /> 프로필 수정</button></section>
            <section><div className="setting-heading"><span className="menu-icon green"><HardDrive /></span><div><b>브라우저 보관함</b><small>{storage.persistent ? "영구 저장 요청이 허용됨" : "브라우저 정책에 따라 관리됨"}</small></div></div><div className="storage-bar"><i style={{ width: storage.quota ? `${Math.min(100, (storage.usage / storage.quota) * 100)}%` : "1%" }} /></div><p>{bytesLabel(storage.usage)} 사용 중 {storage.quota ? `· 약 ${bytesLabel(storage.quota)} 사용 가능` : ""}</p></section>
            <section><div className="setting-heading"><span className="menu-icon amber"><Download /></span><div><b>전체 백업</b><small>{lastBackupAt ? `마지막 백업 ${new Intl.DateTimeFormat("ko-KR").format(new Date(lastBackupAt))}` : "아직 백업하지 않았어요"}</small></div></div><div className="setting-actions"><button className="primary-button" onClick={() => void handleBackup()}><Download size={16} /> ZIP 백업 만들기</button><button className="soft-button" onClick={() => restoreFileInput.current?.click()}><ArchiveRestore size={16} /> 복원하기</button><input ref={restoreFileInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void handleRestore(event.target.files?.[0])} /></div><p className="setting-warning">백업 ZIP에는 일기와 사진이 암호화되지 않은 상태로 들어 있어요. 안전한 곳에 보관해 주세요.</p></section>
            <section><div className="setting-heading"><span className="menu-icon cream"><MoreHorizontal /></span><div><b>데이터 관리</b><small>이 브라우저의 기록만 관리합니다</small></div></div><button className="danger-button full" onClick={() => void clearAllData()}><Trash2 size={16} /> 모든 로컬 데이터 삭제</button></section>
          </div>
        </ModalShell>
      )}

      {profileModal}

      {toast && <div className="toast"><Leaf size={16} />{toast}</div>}
    </main>
  );
}

function AttachmentPreview({ attachment }: { attachment: AttachmentRecord }) {
  const [url] = useState(() => URL.createObjectURL(attachment.blob));
  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);
  if (attachment.mimeType.startsWith("image/")) {
    // Blob URLs are local IndexedDB assets and cannot use the remote image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <a className="image-preview" href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.originalName} /><span>{attachment.originalName}</span></a>;
  }
  return <a className="file-preview" href={url} download={attachment.originalName}><FileText size={22} /><span><b>{attachment.originalName}</b><small>{bytesLabel(attachment.byteSize)}</small></span><Download size={16} /></a>;
}

function AttachmentThumbnail({ attachment }: { attachment: AttachmentRecord }) {
  const [url] = useState(() => attachment.mimeType.startsWith("image/") ? URL.createObjectURL(attachment.blob) : "");
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (!url) return <span className="file-icon"><FileText size={17} /></span>;
  // Blob URLs are local IndexedDB assets and cannot use the remote image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="attachment-thumbnail" src={url} alt={attachment.originalName} />;
}

function ChatAttachmentGallery({ attachmentIds }: { attachmentIds: string[] }) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const idsKey = attachmentIds.join(",");

  useEffect(() => {
    let active = true;
    void (async () => {
      const records = await db.attachments.bulkGet(idsKey ? idsKey.split(",") : []);
      if (active) setAttachments(records.filter(Boolean) as AttachmentRecord[]);
    })();
    return () => { active = false; };
  }, [idsKey]);

  if (!attachments.length) return null;
  return <div className="chat-attachment-gallery">{attachments.map((attachment) => <StoredChatAttachment attachment={attachment} key={attachment.id} />)}</div>;
}

function StoredChatAttachment({ attachment }: { attachment: AttachmentRecord }) {
  const [url] = useState(() => URL.createObjectURL(attachment.blob));
  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (attachment.mimeType.startsWith("image/")) {
    // Blob URLs are local IndexedDB assets and cannot use the remote image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <a className="chat-photo" href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.originalName} /><span>{attachment.originalName}</span></a>;
  }
  return <a className="chat-document" href={url} download={attachment.originalName}><FileText size={18} /><span><b>{attachment.originalName}</b><small>{bytesLabel(attachment.byteSize)}</small></span></a>;
}

function PendingAttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [url] = useState(() => isImage ? URL.createObjectURL(file) : "");
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return <div className={`pending-file-card ${isImage ? "image" : "document"}`}>
    {isImage ? (
      // Blob URLs are local browser assets and cannot use the remote image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={file.name} />
    ) : <span className="pending-file-icon"><FileText size={19} /></span>}
    <span className="pending-file-name">{file.name}</span>
    <button type="button" onClick={onRemove} aria-label={`${file.name} 제거`}><X size={14} /></button>
  </div>;
}
