export default function RSSLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="size-full">{children}</div>;
}
