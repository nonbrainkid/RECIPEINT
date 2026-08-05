import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RECIPEINT — Signed Launch Preflight",
  description:
    "Declare token launch intent, sign a manifest and compare it with the actual Robinhood Chain transaction.",
  openGraph: {
    title: "RECIPEINT — Catch the mismatch before the signature",
    description: "Creator-side signed launch preflights for Robinhood Chain.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "RECIPEINT — Signed Launch Preflight",
    description: "Intent → signature → onchain match.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
