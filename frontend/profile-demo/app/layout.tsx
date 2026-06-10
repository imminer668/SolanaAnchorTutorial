import type { Metadata } from "next";
import { WalletContextProvider } from "../components/WalletContextProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lesson 14 - PDA Profile Demo",
  description: "Frontend PDA derivation with Anchor and Wallet Adapter",
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
