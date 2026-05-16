const isFirebaseAppHosting =
  process.env.FIREBASE_APP_HOSTING === 'true' ||
  process.env.FIREBASE_APP_HOSTING === '1' ||
  Boolean(process.env.FIREBASE_OUTPUT_BUNDLE_DIR || process.env.NEXTJS_ADAPTER_VERSION);
const isStaticExport = process.env.NEXT_BUILD === 'prod' && !isFirebaseAppHosting;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next',
  output: isStaticExport ? 'export' : isFirebaseAppHosting ? 'standalone' : undefined,
  trailingSlash: isStaticExport,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
  },
  images: {
    unoptimized: true,
  },
  basePath: '',
  assetPrefix: '',
};

module.exports = nextConfig;
