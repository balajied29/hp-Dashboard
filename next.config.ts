import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these out of the bundle: they are CommonJS with dynamic requires and
  // native bindings that Next's bundler mangles.
  serverExternalPackages: ["mongoose", "cloudinary", "express", "multer"],
  /* config options here */
};

export default nextConfig;
