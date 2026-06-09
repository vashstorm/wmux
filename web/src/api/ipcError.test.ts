import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  IpcError,
  IpcErrorCode,
  mapTauriErrorToIpcError,
  isIpcError,
  isIpcErrorCode,
} from "./ipcError.js"
import { ApiError } from "./errors.js"

describe("IpcError", () => {
  describe("constructor and properties", () => {
    it("should create IpcError with code and message", () => {
      const error = new IpcError("not_found", "connection 'local' not found")

      expect(error.code).toBe("not_found")
      expect(error.message).toBe("connection 'local' not found")
      expect(error.name).toBe("IpcError")
    })

    it("should create IpcError from static factory methods", () => {
      const notFound = IpcError.notFound("resource missing")
      const badRequest = IpcError.badRequest("invalid input")
      const conflict = IpcError.conflict("already exists")
      const internal = IpcError.internal("crashed")

      expect(notFound.code).toBe("not_found")
      expect(badRequest.code).toBe("bad_request")
      expect(conflict.code).toBe("conflict")
      expect(internal.code).toBe("internal_error")
    })
  })

  describe("toJSON", () => {
    it("should serialize to JSON with code and message", () => {
      const error = new IpcError("conflict", "config changed on disk")
      const json = error.toJSON()

      expect(json).toEqual({
        code: "conflict",
        message: "config changed on disk",
      })
    })
  })

  describe("toApiError", () => {
    it("should convert to ApiError with default 500 status", () => {
      const ipcError = new IpcError("not_found", "session not found")
      const apiError = ipcError.toApiError()

      expect(apiError).toBeInstanceOf(ApiError)
      expect(apiError.code).toBe("not_found")
      expect(apiError.message).toBe("session not found")
      expect(apiError.status).toBe(500)
    })

    it("should convert to ApiError with custom status", () => {
      const ipcError = new IpcError("bad_request", "invalid name")
      const apiError = ipcError.toApiError(400)

      expect(apiError.status).toBe(400)
    })
  })

  describe("fromPayload", () => {
    it("should create IpcError from payload object", () => {
      const payload = { code: "conflict", message: "duplicate name" }
      const error = IpcError.fromPayload(payload)

      expect(error.code).toBe("conflict")
      expect(error.message).toBe("duplicate name")
    })

    it("should handle unknown code gracefully", () => {
      const payload = { code: "unknown_code", message: "not found" }
      const error = IpcError.fromPayload(payload)

      expect(error.code).toBe("unknown_code")
      expect(error.message).toBe("not found")
    })
  })

  describe("fromUnknown", () => {
    it("should return IpcError as-is", () => {
      const original = new IpcError("bad_request", "invalid")
      const converted = IpcError.fromUnknown(original)

      expect(converted).toBe(original)
    })

    it("should convert Error to IpcError with internal_error", () => {
      const original = new Error("Something went wrong")
      const converted = IpcError.fromUnknown(original)

      expect(converted.code).toBe("internal_error")
      expect(converted.message).toBe("Something went wrong")
    })

    it("should convert string to IpcError with internal_error", () => {
      const converted = IpcError.fromUnknown("just a string")

      expect(converted.code).toBe("internal_error")
      expect(converted.message).toBe("just a string")
    })

    it("should convert null/undefined to default IpcError", () => {
      const fromNull = IpcError.fromUnknown(null)
      const fromUndefined = IpcError.fromUnknown(undefined)

      expect(fromNull.code).toBe("internal_error")
      expect(fromNull.message).toBe("null")
      expect(fromUndefined.code).toBe("internal_error")
      expect(fromUndefined.message).toBe("undefined")
    })
  })
})

describe("mapTauriErrorToIpcError", () => {
  it("should map object with code and message", () => {
    const tauriError = { code: "not_found", message: "Connection missing" }
    const result = mapTauriErrorToIpcError(tauriError)

    expect(result).toBeInstanceOf(IpcError)
    expect(result.code).toBe("not_found")
    expect(result.message).toBe("Connection missing")
  })

  it("should handle tauri error with string code", () => {
    const tauriError = { code: "conflict", message: "Already exists" }
    const result = mapTauriErrorToIpcError(tauriError)

    expect(result.code).toBe("conflict")
  })

  it("should default to internal_error for missing fields", () => {
    const tauriError = { data: "some data" }
    const result = mapTauriErrorToIpcError(tauriError)

    expect(result.code).toBe("internal_error")
  })

  it("should convert plain Error", () => {
    const error = new Error("Network failure")
    const result = mapTauriErrorToIpcError(error)

    expect(result.code).toBe("internal_error")
    expect(result.message).toBe("Network failure")
  })

  it("should convert string to internal_error", () => {
    const result = mapTauriErrorToIpcError("Some error string")

    expect(result.code).toBe("internal_error")
    expect(result.message).toBe("Some error string")
  })
})

describe("isIpcError", () => {
  it("should return true for IpcError instances", () => {
    const error = new IpcError("bad_request", "test")
    expect(isIpcError(error)).toBe(true)
  })

  it("should return false for ApiError", () => {
    const error = new ApiError("bad_request", "test", 400)
    expect(isIpcError(error)).toBe(false)
  })

  it("should return false for plain Error", () => {
    const error = new Error("test")
    expect(isIpcError(error)).toBe(false)
  })

  it("should return false for null/undefined", () => {
    expect(isIpcError(null)).toBe(false)
    expect(isIpcError(undefined)).toBe(false)
  })

  it("should return false for objects without IpcError properties", () => {
    expect(isIpcError({ foo: "bar" })).toBe(false)
  })
})

describe("isIpcErrorCode", () => {
  it("should return true for valid error codes", () => {
    expect(isIpcErrorCode("not_found")).toBe(true)
    expect(isIpcErrorCode("bad_request")).toBe(true)
    expect(isIpcErrorCode("conflict")).toBe(true)
    expect(isIpcErrorCode("internal_error")).toBe(true)
  })

  it("should return false for invalid codes", () => {
    expect(isIpcErrorCode("unauthorized")).toBe(false)
    expect(isIpcErrorCode("timeout")).toBe(false)
    expect(isIpcErrorCode("")).toBe(false)
  })
})

describe("IpcErrorCode type", () => {
  it("should accept all valid IPC error codes", () => {
    const codes: IpcErrorCode[] = ["not_found", "bad_request", "conflict", "internal_error"]
    const errors = codes.map((code) => new IpcError(code, "test"))

    expect(errors.every((e) => e instanceof IpcError)).toBe(true)
  })
})