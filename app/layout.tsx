import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  other: { "mobile-web-app-capable": "yes" },
  title: "Dogwise Academy",
  description: "Kennel calendar and trainer hub for Dogwise Academy",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-32.png", sizes: "32x32" }, { url: "/icons/icon-64.png", sizes: "64x64" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Dogwise", statusBarStyle: "default" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#9878F8" };

// Dark mode is saved on this device (Your account → Appearance). Set before the page paints, so it never flashes light first.
const THEME = `try{if(localStorage.getItem("dw-theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
