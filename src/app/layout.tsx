import type { Metadata } from "next";
import Script from "next/script";

import { ThemeToggle } from "@/app/ui/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simple Language Learning",
  description: "Login and registration for Simple Language Learning.",
};

const themeInitializationScript = `
(() => {
  const storedTheme = window.localStorage.getItem("theme");
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : (systemPrefersDark ? "dark" : "light");

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
