import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "elevated" | "accent";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children?: ReactNode;
}

const variantClasses: Record<CardVariant, string> = {
  default: "atelier-card-default",
  elevated: "atelier-card-elevated",
  accent: "atelier-card-accent",
};

export function Card({ variant = "default", className, children, ...rest }: CardProps) {
  const classes = ["atelier-card", variantClasses[variant], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["atelier-card-header", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["atelier-card-body", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["atelier-card-footer", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
