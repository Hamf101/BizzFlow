"use client"

import dynamic from "next/dynamic"

/** The tab icon loads after the page so it never delays the workspace. */
export const BizFlowFavicon = dynamic(() => import("./themed-favicon"), { ssr: false })
