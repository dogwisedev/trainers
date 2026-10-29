import Image from "next/image";

/** The Dogwise Academy logo: navy wordmark in light mode, a light wordmark in dark mode (public/brand-logo-dark.png). */
export function BrandLogo({ width, height, priority = true }: { width: number; height: number; priority?: boolean }) {
  return (
    <>
      <Image src="/brand-logo.png" alt="Dogwise Academy" width={width} height={height} priority={priority} className="dark:hidden" />
      <Image src="/brand-logo-dark.png" alt="Dogwise Academy" width={width} height={height} priority={priority} className="hidden dark:block" />
    </>
  );
}
