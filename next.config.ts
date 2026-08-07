import type { NextConfig } from "next";

// GitHub Pages serves the repo at https://<user>.github.io/<repo>/
// so we need a basePath/assetPrefix when NOT using a custom domain.
// Set NEXT_PUBLIC_BASE_PATH in your GitHub Actions workflow (see .github/workflows/deploy.yml)
// to "/your-repo-name" — leave empty if you use a custom domain or user/org page.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export", // static export -> works on GitHub Pages
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  trailingSlash: true, // GitHub Pages needs trailing slash for folder-style routing
  images: {
    unoptimized: true, // next/image optimization needs a server; disable for static export
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
