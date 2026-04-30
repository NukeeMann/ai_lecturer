import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Lecturer",
  description: "Single-user local web app for interactive AI-generated lessons.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
