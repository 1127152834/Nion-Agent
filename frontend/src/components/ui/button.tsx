import * as React from "react";
import { Loader2 } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 data-[loading=true]:cursor-progress aria-[disabled=true]:pointer-events-none aria-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "cursor-pointer bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "cursor-pointer border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "cursor-pointer hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "cursor-pointer text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  loadingText,
  loadingIcon,
  keepWidth = false,
  children,
  disabled,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    loadingText?: React.ReactNode;
    loadingIcon?: React.ReactNode;
    keepWidth?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  const resolvedDisabled = Boolean(disabled || loading);
  const loadingContent = (
    <>
      {loadingIcon ?? <Loader2 className="size-4 animate-spin" />}
      <span>{loadingText ?? children}</span>
    </>
  );

  const content = loading
    ? keepWidth
      ? (
        <>
          <span className="invisible">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center gap-2">
            {loadingContent}
          </span>
        </>
      )
      : loadingContent
    : children;

  return (
    <Comp
      data-slot="button"
      data-loading={loading ? "true" : undefined}
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({ variant, size, className }),
        keepWidth && loading && "relative",
      )}
      aria-busy={loading || undefined}
      aria-disabled={asChild ? resolvedDisabled : undefined}
      disabled={!asChild ? resolvedDisabled : undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {content}
    </Comp>
  );
}

export { Button, buttonVariants };
