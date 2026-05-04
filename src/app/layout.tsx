import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "katex/dist/katex.min.css";
import "./globals.css";
import { GlobalShortcutsHost } from "@/components/GlobalShortcutsHost";

export const metadata: Metadata = {
  title: "AI Lecturer",
  description: "Single-user local web app for interactive AI-generated lessons.",
};

// Runs synchronously in <head> before paint to prevent a flash of the wrong
// theme/density/accent. Reads localStorage['aiLecturer.theme'] (values:
// light|dark|system; missing/system falls back to prefers-color-scheme),
// localStorage['aiLecturer.density'] (compact|comfortable|spacious), and —
// when on a /courses/<slug>/... route — localStorage['aiLecturer.accent.
// <slug>'] for any user accent override (course defaults declared in
// course.json apply later via the lesson page once the JSON loads).
const themeBootstrap = `(function(){try{var d=document.documentElement;var s=localStorage.getItem('aiLecturer.theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.setAttribute('data-theme',t);var ds=localStorage.getItem('aiLecturer.density');if(ds==='compact'||ds==='comfortable'||ds==='spacious'){d.setAttribute('data-density',ds);}var m=location.pathname.match(/^\\/courses\\/([^\\/]+)/);if(m){var a=localStorage.getItem('aiLecturer.accent.'+m[1]);if(a==='default'||a==='black'||a==='indigo'||a==='terracotta'||a==='emerald'){d.setAttribute('data-accent',a);}}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-accent="default"
      data-density="comfortable"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <GlobalShortcutsHost />
      </body>
    </html>
  );
}
