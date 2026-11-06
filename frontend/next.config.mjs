// The browser only talks to this app; these rewrites forward to the backend services,
// so there is no CORS setup and no backend port hard-coded in browser code.
const EXECUTION_URL = process.env.EXECUTION_URL;
const STORAGE_URL = process.env.STORAGE_URL;
// CORVEN API (sign-in, organizations, incidents, console). Started by ./run.sh on :3001.
const CORVEN_API_URL = process.env.CORVEN_API_URL || "http://127.0.0.1:3001";

/** @type {import('next').NextConfig} */
export default {
  // Storing a job description sends a transaction and waits for storage nodes
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [
      ...(EXECUTION_URL ? [{ source: "/exec/:path*", destination: `${EXECUTION_URL}/:path*` }] : []),
      ...(STORAGE_URL ? [{ source: "/storage/:path*", destination: `${STORAGE_URL}/storage/:path*` }] : []),
      { source: "/api/v1/:path*", destination: `${CORVEN_API_URL}/api/v1/:path*` },
      { source: "/health", destination: `${CORVEN_API_URL}/health` },
    ];
  },
};
