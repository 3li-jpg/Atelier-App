import "../styles/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atelier — Chat-first agentic coding in your browser",
  description:
    "Open-source, chat-first agentic coding. Import a GitHub repo and chat with an agent that edits code, runs tests, and ships PRs from an isolated cloud sandbox. Bring your own model key — free if you bring your own compute (E2B or Daytona).",
  metadataBase: new URL("https://atelier.dev"),
  openGraph: {
    title: "Atelier — Chat-first agentic coding in your browser",
    description:
      "Import a GitHub repo and chat with an agent that edits code, runs tests, and ships PRs. Bring your own model key; free if you bring your own compute (E2B or Daytona).",
    url: "https://atelier.dev",
    siteName: "Atelier",
    type: "website",
    images: [{ url: "/og.svg", width: 1200, height: 630, alt: "Atelier — chat-first agentic coding" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atelier — Chat-first agentic coding in your browser",
    description:
      "Import a GitHub repo, chat with an agent, ship PRs. Bring your own key; free with your own compute (E2B or Daytona).",
    images: ["/og.svg"],
  },
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
