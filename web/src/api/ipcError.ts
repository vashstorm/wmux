import { ApiError } from "./errors.js"

export type IpcErrorCode = "not_found" | "bad_request" | "conflict" | "internal_error"

export interface IpcErrorPayload {
  code: string
  message: string
}

export class IpcError extends Error {
  readonly code: IpcErrorCode
  override readonly message: string

  constructor(code: IpcErrorCode | string, message: string) {
    super(message)
    this.name = "IpcError"
    this.code = isIpcErrorCode(code) ? code : (code as IpcErrorCode)
    this.message = message
  }

  toJSON(): IpcErrorPayload {
    return {
      code: this.code,
      message: this.message,
    }
  }

  toApiError(status: number = 500): ApiError {
    return new ApiError(this.code, this.message, status)
  }

  static fromPayload(payload: IpcErrorPayload): IpcError {
    return new IpcError(payload.code, payload.message)
  }

  static fromUnknown(error: unknown): IpcError {
    if (error instanceof IpcError) {
      return error
    }
    if (error instanceof Error) {
      return new IpcError("internal_error", error.message)
    }
    return new IpcError("internal_error", String(error))
  }

  static notFound(message: string): IpcError {
    return new IpcError("not_found", message)
  }

  static badRequest(message: string): IpcError {
    return new IpcError("bad_request", message)
  }

  static conflict(message: string): IpcError {
    return new IpcError("conflict", message)
  }

  static internal(message: string): IpcError {
    return new IpcError("internal_error", message)
  }
}

export function mapTauriErrorToIpcError(tauriError: unknown): IpcError {
  if (tauriError && typeof tauriError === "object") {
    const errorObj = tauriError as Record<string, unknown>

    if (typeof errorObj.message === "string") {
      const code =
        typeof errorObj.code === "string" ? (errorObj.code as IpcErrorCode) : "internal_error"

      const message =
        typeof errorObj.message === "string" ? errorObj.message : "Unknown Tauri error"

      return new IpcError(code, message)
    }
  }

  if (tauriError instanceof Error) {
    return IpcError.fromUnknown(tauriError)
  }

  return new IpcError("internal_error", String(tauriError))
}

export function isIpcError(value: unknown): value is IpcError {
  return value instanceof IpcError
}

export function isIpcErrorCode(code: string): code is IpcErrorCode {
  return ["not_found", "bad_request", "conflict", "internal_error"].includes(code)
}
