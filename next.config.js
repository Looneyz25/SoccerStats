const repoName = 'SoccerStats';
const isGithubPages = process.env.GITHUB_ACTIONS === 'true';
const isProdBuild = process.env.NEXT_BUILD === 'prod';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: isProdBuild ? '.next-build' : '.next',
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  trailingSlash: true,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
  },
  images: {
    unoptimized: true,
  },
  basePath: isGithubPages ? `/${repoName}` : '',
  assetPrefix: isGithubPages ? `/${repoName}/` : '',
};

module.exports = nextConfig;
