import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@yclaw/core', '@yclaw/memory'],
  output: 'standalone',
  serverExternalPackages: [
    'ws', 'bufferutil', 'utf-8-validate',
    'argon2', 'ioredis', 'mongodb',
  ],
  turbopack: {
    root: resolve(__dirname, '../../'),
  },
  // Webpack fallback — only used when explicitly building with --webpack.
  // Turbopack (default in Next 16) uses serverExternalPackages directly.
  webpack: (config, { isServer }) => {
    if (isServer) {
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
  },
};

export default nextConfig;
