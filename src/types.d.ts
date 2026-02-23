export {};

declare global {
  interface Navigator {
    ai?: any;
    modelContext?: any;
  }
  interface Window {
    ai?: any;
  }
}