"use client";

import dynamic from "next/dynamic";

/** The lab only runs in the browser (WebGL, canvas sampling); load it client-side with a quiet placeholder. */
const ParticleLab = dynamic(() => import("./ParticleLab").then((m) => m.ParticleLab), {
  ssr: false,
  loading: () => <div className="dot-field h-svh w-full bg-ground" aria-hidden="true" />,
});

export function LabClient() {
  return <ParticleLab />;
}
