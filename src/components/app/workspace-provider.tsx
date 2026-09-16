"use client";

import * as React from "react";
import type { WorkArea } from "@/lib/types";

export type ProjectOption = { id: string; name: string; work_area_id: string | null; status: string };

export type WorkspaceContextValue = {
  userId: string;
  email: string | null;
  displayName: string | null;
  timezone: string;
  today: string;
  weekStartsOn: 0 | 1;
  workAreas: WorkArea[];
  projects: ProjectOption[];
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: React.ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
