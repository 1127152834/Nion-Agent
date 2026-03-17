"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const pathname = usePathname();
  const isElectron = process.env.NEXT_PUBLIC_IS_ELECTRON === "1";
  return (
    <NextThemesProvider
      {...props}
      // "/" in desktop just redirects into workspace; forcing dark there causes a visible dark flash
      // when the route changes. Keep the landing-page behavior for web, but disable it in Electron.
      forcedTheme={!isElectron && pathname === "/" ? "dark" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
