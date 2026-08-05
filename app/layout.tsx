import type { Metadata } from "next";
import "./globals.css";

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
  icons: {
    icon: "/brand/recipeint-avatar.png",
    shortcut: "/brand/recipeint-avatar.png",
    apple: "/brand/recipeint-avatar.png",
  },
};

const themeScript = `(() => {
  try {
    const saved = localStorage.getItem("recipeint:theme");
    const preferred = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : preferred;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
