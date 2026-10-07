/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BigQuery client uses Node APIs not available in edge runtime
  experimental: {
    serverComponentsExternalPackages: ['@google-cloud/bigquery'],
  },
  // The Plan page is now Goals. The query string (client, view, period) is kept.
  async redirects() {
    return [{ source: '/plan', destination: '/goals', permanent: false }];
  },
};

module.exports = nextConfig;
