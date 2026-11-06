// The browser only talks to this app; these rewrites forward to the backend services,
// so there is no CORS setup and no backend port hard-coded in browser code.
const EXECUTION_URL = process.env.EXECUTION_URL || "http://127.0.0.1:8000";
const STORAGE_URL = process.env.STORAGE_URL || "http://127.0.0.1:8020";

/** @type {import('next').NextConfig} */
export default {
  // Storing a job description on 0G sends a transaction there and waits for the storage nodes,
  // which can take well over the proxy's default 30 s.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [
      { source: "/exec/:path*", destination: `${EXECUTION_URL}/:path*` },
      { source: "/storage/:path*", destination: `${STORAGE_URL}/storage/:path*` },
    ];
  },
};
