const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const normalizedBasePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  env: {
    NEXT_PUBLIC_BASE_PATH: normalizedBasePath,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  basePath: normalizedBasePath,
  assetPrefix: normalizedBasePath || undefined,
};

export default nextConfig;
