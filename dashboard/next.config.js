/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BigQuery client uses Node APIs not available in edge runtime
  experimental: {
    serverComponentsExternalPackages: ['@google-cloud/bigquery'],
  },
  // The Plan page is now Goals. The query string (client, view, period) is kept.
  // Security headers on every response. Framing is refused outright: the
  // sign-in page inside someone else's frame is the clickjacking setup.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: '/plan', destination: '/goals', permanent: false }];
  },
};

module.exports = nextConfig;
