import type { SyncStatus } from './progress-sync'

export function progressStatusLabel(status: SyncStatus | undefined, language: 'en' | 'ja', compact = false): string {
  const ja = language === 'ja'
  const value = status === 'synced' ? ja ? '同期済み' : 'Synced'
    : status === 'saving' ? ja ? '保存中' : 'Saving'
      : status === 'conflict' ? ja ? '競合' : 'Conflict'
        : status === 'offline' ? ja ? '未同期' : 'Not synced'
          : ja ? '読み込み中' : 'Loading'
  const detail = compact ? '' : status === 'conflict'
    ? ja ? ': クラウドは上書きしていません' : ': no cloud overwrite was made'
    : status === 'offline' ? ja ? ': バックアップして再試行してください' : ': keep a local backup and retry' : ''
  return `${ja ? compact ? 'クラウド' : 'クラウドの進捗' : compact ? 'Cloud' : 'Cloud progress'}: ${value}${detail}`
}
