import { redirect } from "next/navigation";

import { pathOfNewThread } from "@/core/threads/utils";

export default function HomePage() {
  redirect(pathOfNewThread());
}
