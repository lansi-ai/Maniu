/** 待处理交互的可选提示音：用 Web Audio 合成，不引入资源文件。 */

/**
 * 播放一声极轻的提示音。
 *
 * 浏览器首次交互前创建 AudioContext 可能被自动播放策略拒绝；失败时静默返回，
 * 不影响通知本身。测试环境没有 Web Audio 时同样不发声。
 */
export function playPendingTone(): void {
  if (typeof AudioContext === 'undefined') return
  let audio: AudioContext | undefined
  try {
    audio = new AudioContext()
    const now = audio.currentTime
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.17)
    oscillator.onended = () => { void audio?.close().catch(() => undefined) }
    void audio.resume().catch(() => undefined)
  } catch {
    // 自动播放被拒或音频设备不可用时只放弃本次提示音。
    void audio?.close().catch(() => undefined)
  }
}
