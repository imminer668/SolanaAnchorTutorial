import type { Metadata } from "next";
import { WalletContextProvider } from "../components/WalletContextProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lesson 13 - Next.js + Anchor Counter",
  description: "Solana Anchor Counter demo with wallet adapter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <WalletContextProvider>{children}</WalletContextProvider>
      </body>
    </html>
  );
}
