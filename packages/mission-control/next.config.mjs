/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@yclaw/core', '@yclaw/memory'],
  output: 'standalone',
  serverExternalPackages: [
    'ws', 'bufferutil', 'utf-8-validate',
    // Auth facade dependencies — must be external to avoid webpack
    // trying to bundle Node-only modules into client/edge bundles
    'argon2', 'ioredis', 'mongodb',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Force Node-only deps to be loaded from node_modules at runtime
      // serverExternalPackages alone doesn't work in monorepo standalone builds
      config.externals.push(
        'ws', 'bufferutil', 'utf-8-validate',
        'argon2', 'ioredis', 'mongodb',
      );
    }
    return config;
  },
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    VAULT_PATH: process.env.VAULT_PATH,
    // NEXTAUTH_SECRET is read from process.env directly (NOT exposed to client bundle)
  },
};

export default nextConfig;
