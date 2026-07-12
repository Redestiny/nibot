import type { NibotBridge } from '@shared/bridge';

import { httpBridge } from './http';

declare global {
  interface Window {
    // Injected by the Electron preload script when packaged as a desktop app;
    // in the browser the HTTP implementation is used.
    nibotBridge?: NibotBridge;
  }
}

export function getBridge(): NibotBridge {
  return window.nibotBridge ?? httpBridge;
}

export { NibotBridgeError } from './http';
