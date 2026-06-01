/**
 * WebAudio utilities for microphone capture, PCM resampling, VAD, and playback.
 * All WebAudio APIs are behind mockable interfaces for testability.
 */

export interface AudioDevices {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createAudioContext: () => AudioContext
}

const defaultDevices: AudioDevices = {
  getUserMedia: (constraints: MediaStreamConstraints) =>
    navigator.mediaDevices.getUserMedia(constraints),
  createAudioContext: () => new AudioContext(),
}

export interface AudioPipelineConfig {
  sampleRateInput: number
  sampleRateOutput: number
  vadThreshold?: number
  vadEnabled?: boolean
  devices?: AudioDevices
}

export interface AudioLevelObserver {
  onLevel: (level: number) => void
}

export class AudioPipeline {
  private config: Required<AudioPipelineConfig>
  private audioCtx: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private playbackQueue: Float32Array[] = []
  private playbackSource: AudioBufferSourceNode | null = null
  private isCapturing = false
  private isPlaying = false

  constructor(config: AudioPipelineConfig) {
    this.config = {
      sampleRateInput: config.sampleRateInput,
      sampleRateOutput: config.sampleRateOutput,
      vadThreshold: config.vadThreshold ?? 100,
      vadEnabled: config.vadEnabled ?? false,
      devices: config.devices ?? defaultDevices,
    }
  }

  async startCapture(
    onFrame: (frameBase64: string, sampleRate: number) => void,
    levelObserver?: AudioLevelObserver,
  ): Promise<void> {
    if (this.isCapturing) return

    this.audioCtx = this.config.devices.createAudioContext()
    await this.audioCtx.resume()

    this.mediaStream = await this.config.devices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: this.config.sampleRateInput,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream)

    const bufferSize = 4096
    this.scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1)

    this.sourceNode.connect(this.scriptNode)
    this.scriptNode.connect(this.audioCtx.destination)

    this.scriptNode.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer
      const inputData = inputBuffer.getChannelData(0)
      const resampled = this.resamplePCM(
        inputData,
        inputBuffer.sampleRate,
        this.config.sampleRateInput,
      )
      const level = this.computeLevel(resampled)

      levelObserver?.onLevel(level)

      if (this.config.vadEnabled && level < this.config.vadThreshold) {
        return
      }

      const int16 = this.floatToPCM16(resampled)
      const base64 = this.arrayBufferToBase64(int16.buffer as ArrayBuffer)
      onFrame(base64, this.config.sampleRateInput)
    }

    this.isCapturing = true
  }

  stopCapture(): void {
    this.isCapturing = false

    if (this.scriptNode) {
      this.scriptNode.disconnect()
      this.scriptNode.onaudioprocess = null
      this.scriptNode = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }
    if (this.audioCtx) {
      void this.audioCtx.close()
      this.audioCtx = null
    }
  }

  enqueuePlayback(pcm16Base64: string, sampleRate: number): void {
    const int16 = this.base64ToInt16Array(pcm16Base64)
    const float32 = this.pcm16ToFloat(int16)
    this.playbackQueue.push(float32)

    if (!this.isPlaying) {
      void this.drainPlaybackQueue(sampleRate)
    }
  }

  private async drainPlaybackQueue(sampleRate: number): Promise<void> {
    if (this.playbackQueue.length === 0) {
      this.isPlaying = false
      return
    }

    this.isPlaying = true

    if (!this.audioCtx) {
      this.audioCtx = this.config.devices.createAudioContext()
      await this.audioCtx.resume()
    }

    const chunks: Float32Array[] = []
    let totalLength = 0
    const maxChunk = Math.min(this.playbackQueue.length, 4)

    for (let i = 0; i < maxChunk; i++) {
      const chunk = this.playbackQueue.shift()
      if (chunk) {
        chunks.push(chunk)
        totalLength += chunk.length
      }
    }

    const buffer = this.audioCtx.createBuffer(1, totalLength, sampleRate)
    const channelData = buffer.getChannelData(0)
    let offset = 0
    for (const chunk of chunks) {
      channelData.set(chunk, offset)
      offset += chunk.length
    }

    const source = this.audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(this.audioCtx.destination)

    source.onended = () => {
      void this.drainPlaybackQueue(sampleRate)
    }

    this.playbackSource = source
    source.start(0)
  }

  stopPlayback(): void {
    this.playbackQueue = []
    if (this.playbackSource) {
      try {
        this.playbackSource.stop()
      } catch {
        void 0
      }
      this.playbackSource = null
    }
    this.isPlaying = false
  }

  isActive(): boolean {
    return this.isCapturing
  }

  private resamplePCM(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input
    const ratio = toRate / fromRate
    const outputLength = Math.ceil(input.length * ratio)
    const output = new Float32Array(outputLength)
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / ratio
      const idx = Math.floor(srcIndex)
      const frac = srcIndex - idx
      if (idx + 1 < input.length) {
        const a = input[idx]
        const b = input[idx + 1]
        output[i] = (a ?? 0) * (1 - frac) + (b ?? 0) * frac
      } else if (idx < input.length) {
        output[i] = input[idx] ?? 0
      }
    }
    return output
  }

  private computeLevel(samples: Float32Array): number {
    if (samples.length === 0) return 0
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] ?? 0
      sum += v * v
    }
    return Math.sqrt(sum / samples.length) * 100
  }

  private floatToPCM16(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0))
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return output
  }

  private pcm16ToFloat(input: Int16Array): Float32Array {
    const output = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      output[i] = (input[i] ?? 0) / 0x8000
    }
    return output
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ""
    for (let i = 0; i < bytes.byteLength; i++) {
      const byte = bytes[i]
      if (byte !== undefined) {
        binary += String.fromCharCode(byte)
      }
    }
    return btoa(binary)
  }

  private base64ToInt16Array(base64: string): Int16Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Int16Array(bytes.buffer)
  }

  getContext(): AudioContext | null {
    return this.audioCtx
  }
}
