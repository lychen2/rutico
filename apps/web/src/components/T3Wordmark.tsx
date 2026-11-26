import type { SVGProps } from "react";

export function T3Wordmark({
  animated = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  readonly animated?: boolean;
}) {
  return (
    <svg
      {...props}
      data-wordmark-animated={animated ? "true" : undefined}
      viewBox="32 20 76 86"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-wordmark-part={animated ? "stem" : undefined}
        d="M35 34C35 29.5817 38.5817 26 43 26H66.5C80.5833 26 90 34.4 90 46.5C90 57.6 82.05 65.4 69.8 66.8H51V54.2H65.2C71.7 54.2 75.6 51.3 75.6 46.5C75.6 41.7 71.7 38.8 65.2 38.8H50.2V94C50.2 98.4183 46.6183 102 42.2 102H40.5C37.4624 102 35 99.5376 35 96.5V34Z"
        fill="currentColor"
      />
      <path
        data-wordmark-part={animated ? "leg" : undefined}
        d="M56.5 70.5H72.2C74.9 70.5 77.4 71.9 78.8 74.2L94.4 99.2C95.3 100.6 94.1 102.4 92.5 102L84.8 99.8L79.6 102.5C78.4 103.1 76.9 102.6 76.2 101.5L56.5 70.5Z"
        fill="currentColor"
        fillOpacity={0.78}
      />
      <path
        data-wordmark-part={animated ? "spark" : undefined}
        d="M97 23L99.5 29.5L106 32L99.5 34.5L97 41L94.5 34.5L88 32L94.5 29.5L97 23Z"
        fill="currentColor"
        fillOpacity={0.9}
      />
    </svg>
  );
}
