import { describe, test, expect, vi, beforeEach } from "vitest"
import { AudioPipeline } from "./audioPipeline.js"

function mockAudioContext() {
  const ctx = {
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    createScriptProcessor: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null as
        | ((e: {
            inputBuffer: { getChannelData: (n: number) => Float32Array; sampleRate: number }
          }) => void)
        | null,
    }),
    createBuffer: vi.fn().mockReturnValue({
      getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
    }),
    createBufferSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
      buffer: null,
    }),
    destination: {},
    sampleRate: 48000,
  }
  return ctx
}

describe("AudioPipeline", () => {
  let mockCtx: ReturnType<typeof mockAudioContext>
  let mockStream: MediaStream

  beforeEach(() => {
    mockCtx = mockAudioContext()
    const tracks: MediaStreamTrack[] = []
    mockStream = {
      getTracks: vi.fn().mockReturnValue(tracks),
    } as unknown as MediaStream

    vi.stubGlobal(
      "AudioContext",
      vi.fn().mockImplementation(() => mockCtx),
    )
  })

  test("startCapture calls getUserMedia with correct constraints", async () => {
    const devices = {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
      createAudioContext: vi.fn().mockReturnValue(mockCtx),
    }
    const pipeline = new AudioPipeline({
      sampleRateInput: 16000,
      sampleRateOutput: 24000,
      devices,
    })

    const onFrame = vi.fn()
    await pipeline.startCapture(onFrame)

    expect(devices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
  })

  test("stopCapture cleans up resources", async () => {
    const stopTrack = vi.fn()
    const mockTrack = { stop: stopTrack } as unknown as MediaStreamTrack
    const streamWithTrack = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    } as unknown as MediaStream

    const devices = {
      getUserMedia: vi.fn().mockResolvedValue(streamWithTrack),
      createAudioContext: vi.fn().mockReturnValue(mockCtx),
    }
    const pipeline = new AudioPipeline({
      sampleRateInput: 16000,
      sampleRateOutput: 24000,
      devices,
    })

    await pipeline.startCapture(vi.fn())
    pipeline.stopCapture()

    expect(stopTrack).toHaveBeenCalled()
  })

  test("enqueuePlayback decodes base64 and queues for playback", () => {
    const devices = {
      getUserMedia: vi.fn(),
      createAudioContext: vi.fn().mockReturnValue(mockCtx),
    }
    const pipeline = new AudioPipeline({
      sampleRateInput: 16000,
      sampleRateOutput: 24000,
      devices,
    })

    const base64 = btoa(String.fromCharCode(0, 0, 0, 0))
    pipeline.enqueuePlayback(base64, 24000)

    expect(devices.createAudioContext).toHaveBeenCalled()
  })

  test("isActive returns false before capture", () => {
    const devices = {
      getUserMedia: vi.fn(),
      createAudioContext: vi.fn().mockReturnValue(mockCtx),
    }
    const pipeline = new AudioPipeline({
      sampleRateInput: 16000,
      sampleRateOutput: 24000,
      devices,
    })

    expect(pipeline.isActive()).toBe(false)
  })

  test("VAD skips low-level frames", async () => {
    type AudioProcessEvent = {
      inputBuffer: { getChannelData: (n: number) => Float32Array; sampleRate: number }
    }
    const scriptNode: {
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
      onaudioprocess?: (e: AudioProcessEvent) => void
    } = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    const ctx = mockAudioContext()
    ctx.createScriptProcessor = vi.fn().mockReturnValue(scriptNode)

    const devices = {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
      createAudioContext: vi.fn().mockReturnValue(ctx),
    }
    const pipeline = new AudioPipeline({
      sampleRateInput: 16000,
      sampleRateOutput: 24000,
      vadEnabled: true,
      vadThreshold: 50,
      devices,
    })

    const onFrame = vi.fn()
    await pipeline.startCapture(onFrame, {
      onLevel: vi.fn(),
    })

    const silentBuffer = new Float32Array(1024)
    scriptNode.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => silentBuffer,
        sampleRate: 16000,
      },
    })

    expect(onFrame).not.toHaveBeenCalled()
  })

  test("resamples PCM when sample rates differ", async () => {
    const pipeline = new AudioPipeline({
      sampleRateInput: 8000,
      sampleRateOutput: 16000,
    })

    const input = new Float32Array([0.5, 0.5, 0.5, 0.5])
    const result = (
      pipeline as unknown as {
        resamplePCM: (i: Float32Array, f: number, t: number) => Float32Array
      }
    ).resamplePCM(input, 8000, 16000)
    expect(result.length).toBe(8)
  })
})
