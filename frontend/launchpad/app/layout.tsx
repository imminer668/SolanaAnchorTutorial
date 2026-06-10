import type { Metadata } from "next";
import { WalletContextProvider } from "../components/WalletContextProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lesson 19 - Launchpad",
  description: "Solana Anchor Launchpad frontend demo",
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
