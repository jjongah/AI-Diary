import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "나무의 서재 | AI 대화형 일기",
  description: "평범한 하루의 작은 장면을 AI 서재지기와 이야기하고 한 편의 일기로 남기는 로컬 저장 웹 앱",
  icons: {
    icon: "/worldtree-bg.png",
    shortcut: "/worldtree-bg.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
