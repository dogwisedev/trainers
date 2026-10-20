/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The service worker must always be fresh, and may control the whole site
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] }];
  }
};
