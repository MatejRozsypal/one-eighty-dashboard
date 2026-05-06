/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BigQuery client uses Node APIs not available in edge runtime
  experimental: {
    serverComponentsExternalPackages: ['@google-cloud/bigquery'],
  },
};

module.exports = nextConfig;
