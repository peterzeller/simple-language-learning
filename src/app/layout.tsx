import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simple Language Learning",
  description: "Login and registration for Simple Language Learning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
