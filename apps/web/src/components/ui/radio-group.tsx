import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "~/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      className={cn("flex flex-col gap-3", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "relative inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding shadow-xs/5 outline-none transition-[border-color,background-color,box-shadow,scale] duration-150 ease-out motion-safe:not-data-disabled:active:scale-95 motion-reduce:transition-none not-data-disabled:not-data-checked:not-aria-invalid:any-hover:border-foreground/30 before:pointer-events-none before:absolute before:inset-0 before:rounded-full not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:outline-destructive/48 data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:size-4 dark:not-data-checked:bg-input/32 dark:focus-visible:aria-invalid:outline-destructive/24 dark:not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
        className,
      )}
      data-slot="radio"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="-inset-px pointer-events-none absolute flex size-4.5 items-center justify-center rounded-full opacity-0 transition-[opacity,background-color] duration-150 ease-out motion-reduce:transition-none before:size-2 before:scale-50 before:rounded-full before:bg-primary-foreground before:opacity-0 before:transition-[scale,opacity] before:duration-220 before:ease-(--spring-bouncy) motion-reduce:before:transition-none data-checked:bg-primary data-checked:opacity-100 data-checked:before:scale-100 data-checked:before:opacity-100 sm:size-4 sm:before:size-1.5 data-checked:in-[[data-slot=radio]:focus-visible]:inset-shadow-[0_0_0_3px_var(--background)] data-checked:in-[[data-slot=radio]:focus-visible]:outline-2 data-checked:in-[[data-slot=radio]:focus-visible]:outline-solid data-checked:in-[[data-slot=radio]:focus-visible]:-outline-offset-2 data-checked:in-[[data-slot=radio]:focus-visible]:outline-inherit"
        data-slot="radio-indicator"
        keepMounted
      />
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, Radio, Radio as RadioGroupItem };
