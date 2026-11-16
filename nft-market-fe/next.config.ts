import type { NextConfig } from "next";

// 部署在 /nft 子路径下（Nginx 反代 /nft -> 127.0.0.1:3000）
// 本地 `next dev` 时 basePath 为空，且 API 通过 rewrites 代理到后端
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // 生产环境挂载在 /nft 子路径（Nginx 反代 /nft -> 127.0.0.1:3000）；开发环境走根路径
  basePath: isDev ? undefined : "/nft",

  // 仅开发环境代理后端 API（生产由 Nginx 的 /api/v1/ 规则处理）
  async rewrites() {
    if (!isDev) return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://222.186.34.36:9989/api/v1/:path*",
      },
    ];
  },

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
