"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CheckCircle2, AlertTriangle, Info, XCircle, Loader2 } from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      duration={3500}
      offset={16}
      icons={{
        success: <CheckCircle2 className="text-success size-4" />,
        error: <XCircle className="text-danger size-4" />,
        warning: <AlertTriangle className="text-warning size-4" />,
        info: <Info className="text-brand-soft size-4" />,
        loading: <Loader2 className="text-text-2 size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-surface-3 group-[.toaster]:text-foreground group-[.toaster]:border-line-2 group-[.toaster]:rounded-lg group-[.toaster]:shadow-dialog group-[.toaster]:text-sm",
          title: "group-[.toast]:font-medium",
          description: "group-[.toast]:text-text-2",
          actionButton: "group-[.toast]:bg-brand group-[.toast]:text-white group-[.toast]:font-medium group-[.toast]:rounded-md",
          cancelButton: "group-[.toast]:bg-surface-2 group-[.toast]:text-text-2 group-[.toast]:rounded-md",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
