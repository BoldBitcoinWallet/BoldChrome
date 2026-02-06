declare global {
  // Minimal ambient declaration so TypeScript recognizes the Chrome extension APIs used.
  // For production, consider using the official `@types/chrome` package.
  const chrome: any;
}

export {};
