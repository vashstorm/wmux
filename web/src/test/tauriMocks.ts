import { vi } from "vitest"

export type InvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export type InvokeHandler = (
  cmd: string,
  args?: Record<string, unknown>
) => Promise<unknown>

export type EventHandler<T = unknown> = (payload: T) => void

export interface MockInvokeConfig {
  successResults?: Record<string, unknown>
  errorResponses?: Record<string, { code: string; message: string }>
}

let invokeHandler: InvokeHandler | null = null
const eventListeners = new Map<string, Set<EventHandler>>()

export function createMockInvoke(): {
  mockFn: ReturnType<typeof vi.fn>
  configure: (config: MockInvokeConfig) => void
  reset: () => void
} {
  const mockFn = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (invokeHandler) {
      return invokeHandler(cmd, args)
    }
    throw new Error("invoke not configured - call setupTauriMocks first")
  })

  const configure = (config: MockInvokeConfig) => {
    invokeHandler = async (cmd: string, args?: Record<string, unknown>) => {
      const errorResponse = config.errorResponses?.[cmd]
      if (errorResponse) {
        const error = new Error(errorResponse.message) as Error & {
          code: string
        }
        error.code = errorResponse.code
        throw error
      }

      const successResult = config.successResults?.[cmd]
      if (successResult !== undefined) {
        return successResult
      }

      return undefined
    }
  }

  const reset = () => {
    invokeHandler = null
    mockFn.mockReset()
  }

  return { mockFn, configure, reset }
}

export function createMockListen(): {
  mockFn: ReturnType<typeof vi.fn>
  emit: <T>(event: string, payload: T) => void
  reset: () => void
} {
  const mockFn = vi.fn(
    <T = unknown>(
      _event: string,
      _handler: EventHandler<T>
    ): (() => void) => {
      return () => {}
    }
  )

  const emit = <T>(event: string, payload: T) => {
    const handlers = eventListeners.get(event)
    if (handlers) {
      handlers.forEach((handler) => handler(payload))
    }
  }

  const reset = () => {
    eventListeners.clear()
    mockFn.mockReset()
  }

  return { mockFn, emit, reset }
}

export function createMockEmit(): {
  mockFn: ReturnType<typeof vi.fn>
  reset: () => void
} {
  const mockFn = vi.fn(async (_event: string, _payload?: unknown): Promise<void> => {
    return Promise.resolve()
  })

  const reset = () => {
    mockFn.mockReset()
  }

  return { mockFn, reset }
}

export interface MockChannelConfig<T = unknown> {
  messages?: T[]
  onmessage?: (data: T) => void
  onerror?: (error: Error) => void
  onclose?: () => void
}

export class MockChannel<T = unknown> {
  private _onmessage: ((data: T) => void) | null = null
  private _onerror: ((error: Error) => void) | null = null
  private _onclose: (() => void) | null = null
  private _messages: T[] = []

  constructor(config?: MockChannelConfig<T>) {
    if (config?.onmessage) {
      this._onmessage = config.onmessage
    }
    if (config?.onerror) {
      this._onerror = config.onerror
    }
    if (config?.onclose) {
      this._onclose = config.onclose
    }
    if (config?.messages) {
      this._messages = config.messages
    }
  }

  get onmessage(): ((data: T) => void) | null {
    return this._onmessage
  }

  set onmessage(handler: ((data: T) => void) | null) {
    this._onmessage = handler
  }

  get onerror(): ((error: Error) => void) | null {
    return this._onerror
  }

  set onerror(handler: ((error: Error) => void) | null) {
    this._onerror = handler
  }

  get onclose(): (() => void) | null {
    return this._onclose
  }

  set onclose(handler: (() => void) | null) {
    this._onclose = handler
  }

  async send(_data: T): Promise<void> {
    return Promise.resolve()
  }

  async close(): Promise<void> {
    this._onclose?.()
  }

  simulateMessage(data: T): void {
    if (this._onmessage) {
      this._onmessage(data)
    }
  }

  simulateError(error: Error): void {
    if (this._onerror) {
      this._onerror(error)
    }
  }

  simulateClose(): void {
    if (this._onclose) {
      this._onclose()
    }
  }
}

export function setupTauriMocks(): {
  invoke: ReturnType<typeof createMockInvoke>
  listen: ReturnType<typeof createMockListen>
  emit: ReturnType<typeof createMockEmit>
  Channel: typeof MockChannel
} {
  const invoke = createMockInvoke()
  const listen = createMockListen()
  const emit = createMockEmit()

  vi.mock("@tauri-apps/api/core", async () => {
    return {
      invoke: invoke.mockFn,
      Channel: MockChannel,
    }
  })

  vi.mock("@tauri-apps/api/event", async () => {
    return {
      listen: listen.mockFn,
      emit: emit.mockFn,
    }
  })

  return {
    invoke,
    listen,
    emit,
    Channel: MockChannel,
  }
}

export function resetTauriMocks(): void {
  vi.resetModules()
  eventListeners.clear()
}

export const mockInvokeResponses = {
  success: <T>(data: T): Record<string, unknown> => {
    return { data }
  },
  error: (code: string, message: string): { code: string; message: string } => {
    return { code, message }
  },
}

export function createTauriError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}