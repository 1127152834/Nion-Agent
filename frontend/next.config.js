/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const isDesktopBuild = process.env.NION_DESKTOP_BUILD === "1";

const config = {
  devIndicators: false,
  output: isDesktopBuild ? "standalone" : undefined,
};

export default config;
