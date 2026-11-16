import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  // 子路径部署：前端资源挂载在 /nft/ 下，API 仍走绝对路径 /api/v1（由 Nginx 反代到后端 8083）
  basePath: "/nft",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  // 关闭 ESLint
  eslint: {
    ignoreDuringBuilds: true,
  },

  // wagmi/rainbowkit 新版本间接引入 @coinbase/cdp-sdk，其可选依赖 @x402/* 缺失导致构建失败。
  // 本项目仅用 mainnet/sepolia 的 http transport，不需要 Coinbase smart account，故 stub 掉。
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/core/client": false,
      "@x402/core/schemas": false,
      "@x402/core/server": false,
      "@x402/evm": false,
      "@x402/evm/auth-capture/client": false,
      "@x402/evm/batch-settlement/client": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/exact/server": false,
      "@x402/evm/exact/v1/client": false,
      "@x402/evm/upto/client": false,
      "@x402/evm/upto/server": false,
      "@x402/express": false,
      "@x402/extensions/bazaar": false,
      "@x402/extensions/builder-code": false,
      "@x402/fetch": false,
      "@x402/svm": false,
      "@x402/svm/exact/client": false,
      "@x402/svm/exact/server": false,
      "@x402/svm/exact/v1/client": false,
      "@x402/svm/upto/client": false,
      "@x402/svm/upto/server": false,
    };
    return config;
  },

  output: "standalone",
};

export default nextConfig;
