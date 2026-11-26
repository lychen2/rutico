import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

function Switch({
  className,
  size = "default",
  mixed = false,
  ...props
}: SwitchPrimitive.Root.Props & { size?: "default" | "sm"; mixed?: boolean }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer items-center rounded-full p-[2px] outline-none transition-[background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input not-data-disabled:data-unchecked:any-hover:bg-foreground/24 not-data-disabled:data-checked:any-hover:bg-primary/90 not-data-disabled:data-[mixed]:any-hover:bg-foreground/24 data-disabled:cursor-not-allowed data-disabled:opacity-64 data-[mixed]:bg-input",
        size === "sm"
          ? "[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3.5)]"
          : "[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
        className,
      )}
      data-size={size}
      data-slot="switch"
      data-mixed={mixed ? "" : undefined}
      // Base UI overwrites aria-checked even with undefined; pass it only for mixed state.
      {...(mixed ? { "aria-checked": "mixed" as const } : {})}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[calc(var(--thumb-size)-2px)] shrink-0 origin-left motion-safe:in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 motion-safe:in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 ring-1 ring-inset ring-foreground/8 dark:data-unchecked:bg-foreground/75 dark:data-unchecked:ring-foreground/15 [transition:translate_200ms_var(--ease-spring-snappy),border-radius_150ms_ease-out,scale_120ms_var(--ease-spring-snappy)_60ms,transform-origin_150ms_ease-out,background-color_150ms_ease-out,box-shadow_150ms_ease-out] motion-reduce:transition-none data-checked:origin-right data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
          mixed &&
            "translate-x-[calc((var(--thumb-size)-4px)/2)] opacity-70 data-checked:translate-x-[calc((var(--thumb-size)-4px)/2)]",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
