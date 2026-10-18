"use client";

import { useId, type InputHTMLAttributes } from "react";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  error?: string;
  hint?: string;
  id?: string;
  label: string;
};

export function TextField({
  error,
  hint,
  id,
  label,
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  return (
    <div className="text-field">
      <label className="text-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        className="text-field__input"
        id={inputId}
      />
      {error ? (
        <p className="text-field__error" id={descriptionId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-field__hint" id={descriptionId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
