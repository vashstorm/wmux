declare module "@tauri-apps/api/core" {
  export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;

  export class Channel<T = unknown> {
    onmessage: ((data: T) => void) | null;
    onerror: ((error: Error) => void) | null;
    onclose: (() => void) | null;
    send(data: T): Promise<void>;
    close(): Promise<void>;
  }
}

declare module "@tauri-apps/api/event" {
  export function listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<() => void>;
  export function emit<T = unknown>(event: string, payload?: T): Promise<void>;
}