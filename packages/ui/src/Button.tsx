import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./Spinner.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: "atelier-btn atelier-btn-sm",
  md: "atelier-btn atelier-btn-md",
  lg: "atelier-btn atelier-btn-lg",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "atelier-btn-primary",
  secondary: "atelier-btn-secondary",
  ghost: "atelier-btn-ghost",
  danger: "atelier-btn-danger",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      className,
      ...rest
    },
    ref
  ) => {
    const classes = [
      sizeClasses[size],
      variantClasses[variant],
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && <Spinner size="sm" />}
        {!loading && leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
