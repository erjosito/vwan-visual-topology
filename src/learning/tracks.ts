import type { Localized } from './content'
import { previewCourse } from './course-profile'

type LearningTrack = {
  id: string
  title: Localized
  summary: Localized
} & ({ status: 'available'; courseId: string } | { status: 'planned'; courseId?: never })

export const learningTracks: readonly LearningTrack[] = [
  {
    id: 'routing-foundations', title: previewCourse.title, status: 'available', courseId: previewCourse.id,
    summary: {
      en: 'Address ownership, peering, appliance chains and hybrid/Virtual WAN troubleshooting. Original and scenario editions retain separate progress and achievements.',
      ja: 'アドレスの所有関係、ピアリング、装置チェーン、ハイブリッドと Virtual WAN の問題解決。従来版とシナリオ版は、別々の進捗と達成を保持します。',
    },
  },
  {
    id: 'dns', title: { en: 'DNS and name resolution', ja: 'DNS と名前解決' }, status: 'planned',
    summary: {
      en: 'Private DNS visibility, resolver context and hybrid name-resolution diagnosis.',
      ja: 'プライベート DNS の可視性、リゾルバーのコンテキスト、ハイブリッド環境の名前解決の診断。',
    },
  },
  {
    id: 'application-delivery', title: { en: 'Application delivery', ja: 'アプリケーション配信' }, status: 'planned',
    summary: {
      en: 'Traffic Manager, Application Gateway and Front Door request selection and separate network legs.',
      ja: 'Traffic Manager、Application Gateway、Front Door の要求の選択と個別のネットワーク接続。',
    },
  },
]

export const trackLabels = {
  overview: { en: 'Learning tracks', ja: '学習トラック' },
  available: { en: 'Available', ja: '利用可能' },
  planned: { en: 'Planned', ja: '計画中' },
  plannedTracks: { en: 'Planned tracks', ja: '計画中のトラック' },
  plannedNotice: {
    en: 'Informational only: no lessons or progress yet, no release date, and nothing to unlock. Planned tracks do not affect your routing progress.',
    ja: '情報のみです。レッスンや進捗、公開日、解除条件はまだありません。計画中のトラックはルーティングの進捗に影響しません。',
  },
  scope: {
    en: 'Belts record completion within a track, not all Azure networking or professional certification. Each track uses the same white-to-black ladder; points do not unlock other tracks.',
    ja: '帯はトラック内の修了を記録するもので、Azure ネットワーク全体の習得や専門資格ではありません。各トラックは同じ白帯から黒帯の段階を使用し、ポイントで別のトラックは解除されません。',
  },
} satisfies Record<string, Localized>
