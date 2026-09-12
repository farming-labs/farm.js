/** Client-owned reset callbacks must not be serialized from the RSC server. */
export function generateErrorFallbackEntry(): string {
  return `"use client";
import React from 'react';

export default function ServerErrorFallback({ Fallback, message, fallbackProps }) {
  const error = new Error(message);
  const reset = () => window.location.reload();
  return React.createElement(Fallback, { ...fallbackProps, error, reset });
}
`;
}
