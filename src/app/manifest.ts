import type { MetadataRoute } from "next"

/**
 * What a phone or computer needs to install BizFlow as an app: its name, the
 * page it opens on, and its icon (drawn by /icons/[size]).
 *
 * @returns The web app manifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BizFlow",
    short_name: "BizFlow",
    description: "Create, organize, sign, and review accountable business documents.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f3f1ed",
    theme_color: "#f3f1ed",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
