import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atelier — Agentic Coding",
  description:
    "Agentic coding from any browser. Bring your own model key. Agents run in isolated sandboxes, edit your repos, and ship PRs.",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;700&family=JetBrains+Mono:wght@400&family=Playfair+Display:ital,wght@1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
