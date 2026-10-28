/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // `npm run export` writes a static copy of the deck to out/ (served by `npm run present`).
  ...(process.env.EXPORT ? { output: 'export' } : {}),
};

export default nextConfig;
