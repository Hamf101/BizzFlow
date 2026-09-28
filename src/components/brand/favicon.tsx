"use client"

import dynamic from "next/dynamic"

/** The tab animation loads after the page so it never delays the workspace. */
export const BizFlowFavicon = dynamic(() => import("./animated-favicon"), { ssr: false })
