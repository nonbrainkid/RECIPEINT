import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RECIPEINT — Signed Launch Preflight",
  description:
    "Declare token launch intent, sign a manifest, verify the onchain result, and follow the public 50/50 fee route.",
  openGraph: {
    title: "RECIPEINT — Catch the mismatch before the signature",
    description: "Signed launch preflights and transparent fee routing for Robinhood Chain.",
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
