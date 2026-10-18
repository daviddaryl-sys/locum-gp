"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  loading?: boolean;
  variant?: "primary" | "secondary";
};

export function Button({
  children,
  className = "",
  disabled,
  loading = false,
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
    >
      {loading ? <span aria-hidden="true" className="button__spinner" /> : null}
      <span>{loading ? `${children}…` : children}</span>
    </button>
  );
}
