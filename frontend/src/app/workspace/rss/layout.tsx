import { RSSContextProvider } from "@/core/rss";

export default function RSSLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <RSSContextProvider>
      <div className="size-full">{children}</div>
    </RSSContextProvider>
  );
}
