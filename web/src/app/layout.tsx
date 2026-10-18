import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

import "@/styles/tokens.css";
import "./globals.css";
import "@/styles/home-refresh.css";

export const metadata: Metadata = {
  title: "Locum Manager",
  description: "Secure, offline-ready GP locum sessions and invoicing.",
  applicationName: "Locum Manager",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Locum Manager",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f6f55",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
