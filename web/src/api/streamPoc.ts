import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface StreamBurstComplete {
  total: number;
}

export interface StreamBurstCleanup {
  (): void;
}

export async function createStreamBurst(
  count: number,
  onChunk: (line: string) => void,
  onDone: () => void
): Promise<StreamBurstCleanup> {
  const channel = new Channel<string>();

  channel.onmessage = (message: string) => {
    onChunk(message);
  };

  await invoke("stream_burst", { count, onEvent: channel });

  const unlistenComplete = await listen<StreamBurstComplete>(
    "stream-burst-complete",
    () => {
      onDone();
    }
  );

  return () => {
    unlistenComplete();
  };
}

export async function collectStreamBurst(
  count: number,
  timeoutMs: number = 30000
): Promise<string[]> {
  const lines: string[] = [];

  return new Promise(async (resolve, reject) => {
    let completed = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = await createStreamBurst(
      count,
      (line) => {
        if (completed) return;
        lines.push(line);
      },
      () => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(lines);
      }
    );

    timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(
          new Error(
            `Stream burst timeout after ${timeoutMs}ms. Received ${lines.length} of ${count} lines.`
          )
        );
      }
    }, timeoutMs);
  });
}