import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The dashboard's own API server (apps/review-dashboard/server) runs on 4000
// by default; proxying /api in dev means the frontend can always call
// same-origin relative paths (src/api.ts), matching how the built app behaves
// in production with no dev-only special-casing.
const API_PROXY_TARGET = process.env.REVIEW_DASHBOARD_API_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Review Dashboard",
        short_name: "Review",
        description: "Scene-by-scene video review and approval gate before YouTube upload.",
        display: "standalone",
        start_url: "/",
        // Matches the channel's own accent (docs/LICENSING.md's branding.accentColor default) and dark base, so the installed app's splash/theming reads as part of the same product as the videos it reviews.
        theme_color: "#0f1420",
        background_color: "#0f1420",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell: cache-first, so the dashboard opens instantly and
        // survives a flaky connection (docs/REVIEW-DASHBOARD.md's PWA spec).
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // Job data and presigned media URLs must NEVER come from cache — a
        // stale preview or an expired presigned URL would be actively
        // misleading during review. NetworkOnly, not NetworkFirst: a
        // network-first cache would still serve a stale response if the
        // network briefly fails, which is worse than just erroring here.
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
});
