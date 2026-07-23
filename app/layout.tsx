import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "德州扑克之夜",
  description: "无需注册的多人德州扑克房间与 GTO 练习工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <noscript>
          <div
            style={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              padding: "24px",
              background: "#01120e",
              color: "#fef3c7",
              textAlign: "center",
            }}
          >
            此牌桌需要启用 JavaScript。请开启后重新加载页面。
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
