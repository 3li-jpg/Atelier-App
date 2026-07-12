import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";

/* ---- Input ---- */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, leftIcon, className, id, ...rest }, ref) => {
    const inputId = id ?? rest.name;
    return (
      <div className="atelier-input-wrap">
        {label && (
          <label htmlFor={inputId} className="atelier-input-label">
            {label}
          </label>
        )}
        <div className="atelier-input-field">
          {leftIcon && <span className="atelier-input-icon">{leftIcon}</span>}
          <input
            ref={ref}
            id={inputId}
            className={["atelier-input", error ? "atelier-input-err" : "", className ?? ""]
              .filter(Boolean)
              .join(" ")}
            {...rest}
          />
        </div>
        {error && <span className="atelier-input-error">{error}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";

/* ---- Textarea ---- */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...rest }, ref) => {
    const inputId = id ?? rest.name;
    return (
      <div className="atelier-input-wrap">
        {label && (
          <label htmlFor={inputId} className="atelier-input-label">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={["atelier-input atelier-textarea", error ? "atelier-input-err" : "", className ?? ""]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />
        {error && <span className="atelier-input-error">{error}</span>}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

/* ---- Select ---- */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...rest }, ref) => {
    const inputId = id ?? rest.name;
    return (
      <div className="atelier-input-wrap">
        {label && (
          <label htmlFor={inputId} className="atelier-input-label">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={["atelier-input atelier-select", error ? "atelier-input-err" : "", className ?? ""]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        >
          {children}
        </select>
        {error && <span className="atelier-input-error">{error}</span>}
      </div>
    );
  }
);
Select.displayName = "Select";
