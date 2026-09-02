import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * firebase-admin pulls in @google-cloud/* packages that use dynamic requires
   * and optional native bindings. Bundling those breaks at runtime on
   * serverless hosts, so they are loaded from node_modules instead.
   */
  serverExternalPackages: ["firebase-admin", "@google-cloud/firestore", "google-gax"],
};

export default nextConfig;
