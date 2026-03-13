import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function RoutePageSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("flex size-full flex-col", className)}>
      <div className="flex h-12 items-center border-b px-4">
        <Skeleton className="h-5 w-52" />
      </div>
      <div className="flex-1 p-4">
        <div className="mx-auto flex h-full w-full max-w-(--container-width-md) flex-col gap-4">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <div className="mt-auto">
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
