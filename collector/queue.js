export const CAPTURE_TTL = 30 * 60 * 1000;
export function freshQueue(queue = [], now = Date.now()) { return queue.filter(item => item.expires > now); }
export function enqueue(queue, packet, captureId, now = Date.now()) {
  const next = freshQueue(queue, now);
  if (next.some(item => item.captureId === captureId)) return next;
  if (next.reduce((n, item) => n + item.packet.blocks.length, 0) + packet.blocks.length > 250) throw new Error('대기 중인 영수증을 먼저 저장해 주세요.');
  return [...next, { captureId, packet, expires: now + CAPTURE_TTL }];
}
export function acknowledge(queue, captureId) { return freshQueue(queue).filter(item => item.captureId !== captureId); }
