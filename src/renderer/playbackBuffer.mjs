export const HLS_BUFFER_CONFIG = Object.freeze({
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferSize: 120 * 1000 * 1000,
  startFragPrefetch: true,
  lowLatencyMode: false,
  backBufferLength: 30,
});

export function shouldPrefetch(time, duration) {
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(time) && time > 0 &&
    (time / duration >= 0.78 || duration - time <= 210);
}

export function bufferedRanges(buffered, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return Array.from({ length: buffered.length }, (_, index) => {
    const start = Math.max(0, Math.min(100, buffered.start(index) / duration * 100));
    const end = Math.max(start, Math.min(100, buffered.end(index) / duration * 100));
    return { start, width: end - start };
  });
}
