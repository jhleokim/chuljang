import type { NextConfig } from "next";
import path from 'node:path';

const nextConfig: NextConfig = {
  experimental: { cpus: 2 },
  serverExternalPackages: ['playwright', 'playwright-core'],
  webpack(config, {webpack}) {
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, path.resolve('selfhost/env.ts')));
    return config;
  },
};

export default nextConfig;
