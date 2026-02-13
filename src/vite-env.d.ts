/// <reference types="vite/client" />

interface Window {
  dataLayer: unknown[];
  gtag?: (
    command: 'config' | 'event' | 'js',
    targetIdOrEventName: string | Date,
    params?: Record<string, string | number | boolean>
  ) => void;
}
