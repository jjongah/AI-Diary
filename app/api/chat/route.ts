import { NextResponse } from "next/server";

export const runtime = "edge";

type Tone = "friendly" | "polite" | "formal";
type AttachmentInput = { name: string; mimeType: string; data: string };
type ProfileInput = {
  name: string;
  age?: number;
  gender?: "female" | "male" | "nonbinary" | "private";
  birthday?: string;
};

interface ChatRequest {
  mode: "chat" | "draft";
  tone?: Tone;
  date?: string;
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachments?: AttachmentInput[];
  profile?: ProfileInput;
}

const toneGuide: Record<Tone, string> = {
  friendly:
    "사용자가 편한 친구와 이야기하는 느낌이 들도록 자연스러운 반말을 사용한다.",
  polite:
    "따뜻하고 부담 없는 해요체를 사용한다.",
  formal:
    "차분하고 예의 있는 존댓말을 사용한다.",
};

const genderLabels: Record<NonNullable<ProfileInput["gender"]>, string> = {
  female: "여성",
  male: "남성",
  nonbinary: "기타/논바이너리",
  private: "공개하지 않음",
};

function profileGuide(profile?: ProfileInput) {
  if (!profile) return "";
  const name = profile.name?.trim().slice(0, 20);
  if (!name) return "";
  const details = [
    profile.age ? `나이 ${profile.age}세` : "",
    profile.gender ? `성별 ${genderLabels[profile.gender]}` : "",
    profile.birthday ? `생일 ${profile.birthday}` : "",
  ].filter(Boolean);
  return ` 사용자의 이름은 ${JSON.stringify(name)}이다${details.length ? ` (${details.join(", ")})` : ""}. 대화 중 자연스러운 순간에 이 이름으로 불러 주되, 매 답변마다 반복하거나 기본 정보를 억지로 언급하지 않는다. 프로필 정보는 관련된 맥락에서만 조심스럽게 참고하고 성격이나 감정을 추측하는 근거로 삼지 않는다.`;
}

function fallbackReply(body: ChatRequest) {
  const message = body.message?.trim() || "오늘 하루";
  const short = message.length > 42 ? `${message.slice(0, 42)}…` : message;
  const name = body.profile?.name?.trim().slice(0, 20);
  if (body.mode === "draft") {
    const userLines = (body.history ?? [])
      .filter((item) => item.role === "user")
      .map((item) => item.content.trim())
      .filter(Boolean);
    return {
      demo: true,
      draft: {
        title: userLines[0]?.slice(0, 24) || "오늘의 작은 기록",
        content:
          userLines.length > 0
            ? userLines.join("\n\n")
            : "오늘의 이야기를 천천히 적어 보았다. 특별하지 않아 보여도 분명 오늘만의 장면이 있었다.",
        mood: "calm",
      },
    };
  }
  const replies: Record<Tone, string> = {
    friendly: `${name ? `${name}, ` : ""}“${short}”라는 장면이 마음에 남았구나. 그때 가장 먼저 떠오른 감정은 뭐였어?`,
    polite: `${name ? `${name}님, ` : ""}“${short}”라는 장면이 마음에 남았군요. 그 순간 어떤 기분이 가장 먼저 들었어요?`,
    formal: `${name ? `${name}님, ` : ""}“${short}”라는 장면이 기억에 남으셨군요. 당시 가장 먼저 느낀 감정을 말씀해 주시겠어요?`,
  };
  return { demo: true, reply: replies[body.tone ?? "polite"] };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json(fallbackReply(body));

    const tone = body.tone ?? "polite";
    const isDraft = body.mode === "draft";
    const userProfileGuide = profileGuide(body.profile);
    const systemText = isDraft
      ? `당신은 사용자의 하루를 정리하는 AI 서재 관리자다. 대화와 첨부물에서 확인된 사실만 사용해 담백한 한국어 일기를 작성한다. 사용자가 말하지 않은 사건이나 감정을 만들지 않는다. 1인칭 시점으로 쓰고 억지 교훈, 진단, 과장된 위로를 피한다. 대화 말투 설정과 무관하게 사용자의 표현과 감정 강도를 유지한다.${userProfileGuide}`
      : `당신은 사용자의 일상 대화 상대이자 AI 서재 관리자 '모아'다. ${toneGuide[tone]} 사용자의 말에 자연스럽게 반응하며 잡담, 공감, 의견, 정보, 질문을 대화의 맥락에 맞게 자유롭게 주고받는다. 매번 질문으로 끝낼 필요가 없고 답변 길이도 상황에 맞게 정한다. 사용자가 오늘 겪은 일과 느낀 감정, 등장한 사람과 기억할 만한 세부 사항을 대화 속에서 이해하되, 일기를 작성해 달라는 요청 전에는 대화를 억지로 요약하거나 교훈으로 마무리하지 않는다. 첨부물은 보이는 내용에 근거해 이야기한다.${userProfileGuide}`;

    const contents: Array<{
      role: "user" | "model";
      parts: Array<Record<string, unknown>>;
    }> = (body.history ?? []).slice(-30).map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));

    const userParts: Array<Record<string, unknown>> = [{
      text: isDraft
        ? `작성 날짜는 ${body.date ?? "오늘"}입니다. 지금까지 나눈 대화와 첨부물을 바탕으로 오늘의 일기 초안을 작성해 주세요.`
        : body.message?.trim() || "이어서 이야기할게요.",
    }];
    for (const attachment of body.attachments ?? []) {
      userParts.push({
        inlineData: { mimeType: attachment.mimeType, data: attachment.data },
      });
      userParts.push({ text: `첨부 파일명: ${attachment.name}` });
    }
    contents.push({ role: "user", parts: userParts });

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: isDraft
            ? {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    content: { type: "STRING" },
                    mood: { type: "STRING" },
                  },
                  required: ["title", "content"],
                },
              }
            : undefined,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: "Gemini 응답을 받지 못했습니다.", detail },
        { status: response.status },
      );
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const text = result?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("빈 AI 응답");

    if (isDraft) {
      return NextResponse.json({ draft: JSON.parse(text) });
    }
    return NextResponse.json({ reply: text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
