import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Shell from "@/components/Shell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ui" });

export const metadata: Metadata = {
  title: "Hotel Palacio — Staff dashboard",
  description: "Reservations, menus and events for Omara and Noya.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
