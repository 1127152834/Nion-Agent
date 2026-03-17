import "@/styles/globals.css";
import "katex/dist/katex.min.css";
import "nprogress/nprogress.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { PluginInitializer } from "@/components/plugin-initializer";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";
import { RouteProgressBar } from "@/core/navigation";

export const metadata: Metadata = {
  title: "Nion",
  description: "A LangChain-based framework for building super agents.",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const IS_ELECTRON = process.env.NEXT_PUBLIC_IS_ELECTRON === "1";
const DEFAULT_THEME = IS_ELECTRON ? "light" : "system";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  return (
    <html
      lang={locale}
      data-electron={IS_ELECTRON ? "1" : undefined}
      className={geist.variable}
      suppressContentEditableWarning
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <PluginInitializer />
        <ThemeProvider
          attribute="class"
          enableSystem
          disableTransitionOnChange
          defaultTheme={DEFAULT_THEME}
        >
          <I18nProvider initialLocale={locale}>
            <RouteProgressBar />
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
