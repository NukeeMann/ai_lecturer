import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { GlobalShortcutsHost } from "@/components/GlobalShortcutsHost";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Lecturer",
  description: "Single-user local web app for interactive AI-generated lessons.",
};

// Runs synchronously in <head> before paint to prevent a flash of the wrong
// theme/density/accent/font/text-scale. Reads localStorage['aiLecturer.theme']
// (light|dark|system; missing/system falls back to prefers-color-scheme),
// localStorage['aiLecturer.density'] (compact|comfortable|spacious),
// localStorage['aiLecturer.font'] (geist|ibm-plex|source-serif),
// localStorage['aiLecturer.textScale'] (float clamped to [0.8, 1.4] applied as
// inline style --text-scale), and — when on a /courses/<slug>/... route —
// localStorage['aiLecturer.accent.<slug>'] for any user accent override
// (course defaults declared in course.json apply later via the lesson page
// once the JSON loads).
const themeBootstrap = `(function(){try{var d=document.documentElement;var s=localStorage.getItem('aiLecturer.theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');d.setAttribute('data-theme',t);var ds=localStorage.getItem('aiLecturer.density');if(ds==='compact'||ds==='comfortable'||ds==='spacious'){d.setAttribute('data-density',ds);}var f=localStorage.getItem('aiLecturer.font');if(f==='geist'||f==='ibm-plex'||f==='source-serif'){d.setAttribute('data-font',f);}var ts=localStorage.getItem('aiLecturer.textScale');if(ts!==null){var n=parseFloat(ts);if(isFinite(n)){if(n<0.8){n=0.8;}else if(n>1.4){n=1.4;}d.style.setProperty('--text-scale',String(n));}}var m=location.pathname.match(/^\\/courses\\/([^\\/]+)/);if(m){var a=localStorage.getItem('aiLecturer.accent.'+m[1]);if(a==='default'||a==='black'||a==='indigo'||a==='terracotta'||a==='emerald'){d.setAttribute('data-accent',a);}}}catch(e){}})();`;

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
      data-font="geist"
      className={`${GeistSans.variable} ${GeistMono.variable} ${ibmPlexSans.variable} ${sourceSerif.variable} h-full antialiased`}
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
