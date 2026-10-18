"use strict";

const CACHE_NAME = "locum-manager-shell-v23";
const PRIVATE_PAGE_CACHE = "locum-manager-private-pages-v20";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                (name.startsWith("locum-manager-shell-") ||
                  name.startsWith("locum-manager-private-pages-")) &&
                name !== CACHE_NAME &&
                name !== PRIVATE_PAGE_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/ocr/") ||
      url.pathname === "/manifest.webmanifest")
  );
}

function isPrivateAppPage(pathname) {
  return (
    pathname === "/dashboard" ||
    pathname === "/sessions" ||
    pathname.startsWith("/sessions/") ||
    pathname === "/invoices" ||
    pathname.startsWith("/invoices/") ||
    pathname === "/expenses" ||
    pathname.startsWith("/expenses/") ||
    pathname === "/tax-mtd" ||
    pathname === "/practices" ||
    pathname.startsWith("/practices/") ||
    pathname === "/more" ||
    pathname.startsWith("/settings/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.ok &&
            !response.redirected &&
            isPrivateAppPage(url.pathname)
          ) {
            const copy = response.clone();
            void caches
              .open(PRIVATE_PAGE_CACHE)
              .then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => {
          if (isPrivateAppPage(url.pathname)) {
            const privatePageCache = await caches.open(PRIVATE_PAGE_CACHE);
            const cachedPage = await privatePageCache.match(url.pathname);
            if (cachedPage) return cachedPage;
          }
          const shellCache = await caches.open(CACHE_NAME);
          const cachedShell = await shellCache.match("/");
          return cachedShell || Response.error();
        }),
    );
    return;
  }

  if (!isCacheableStaticAsset(url)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void cache.put(request, copy);
            }
            return response;
          }),
      ),
    ),
  );
});
