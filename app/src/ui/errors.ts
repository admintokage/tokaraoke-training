export function describeMicError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') {
      return 'マイクの使用が許可されませんでした。設定 › Safari › マイク（またはアドレスバーの「ぁあ」› Webサイトの設定）で許可してください。';
    }
    if (e.name === 'NotFoundError') return 'マイクが見つかりません。';
    if (e.name === 'NotReadableError') return 'マイクを開けませんでした。ほかのアプリが使用中の可能性があります。';
  }
  return `開始できませんでした: ${e instanceof Error ? e.message : String(e)}`;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
