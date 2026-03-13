import { AboutPage } from "@/components/workspace/about/about-page";

export default function WorkspaceAboutPage() {
  return (
    <main className="flex size-full min-h-0 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <AboutPage />
        </div>
      </div>
    </main>
  );
}
