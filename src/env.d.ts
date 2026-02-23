interface Window {
  ai?: any;
}

interface Navigator {
  modelContext?: {
    registerTool: (config: any) => Promise<void>;
  };
  ai?: {
    registerTool: (config: any) => Promise<void>;
  };
}
