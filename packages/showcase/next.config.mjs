import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {
    root: resolve(__dirname, '../../'),
  },
  env: {
    YCLAW_PUBLIC_API_URL: process.env.YCLAW_PUBLIC_API_URL,
  },
};

export default nextConfig;
