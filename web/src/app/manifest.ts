export default function manifest() {
  return {
    id: "/",
    name: "Locum Manager",
    short_name: "Locum Manager",
    description: "Secure, offline-ready GP locum sessions and invoicing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f8f3",
    theme_color: "#2f6f55",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
