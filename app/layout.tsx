import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company Brain",
  description: "Agent-native operating system for governed organizational memory."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
