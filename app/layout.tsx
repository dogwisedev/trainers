import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DogwiseTrainers",
  description: "Kennel calendar and trainer hub for Dogwise Academy",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-64.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Dogwise", statusBarStyle: "default" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#BFF6C3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
