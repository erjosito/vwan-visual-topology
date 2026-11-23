import { lazy, Suspense } from 'react'

const FeedbackDialog = lazy(() => import('./FeedbackDialog').then(module => ({ default: module.FeedbackDialog })))
const OtherPlatformsDialog = lazy(() => import('./OtherPlatformsDialog'))

export default function HelpDialog({ kind, onClose }: {
  kind: 'feedback' | 'platforms'; onClose: () => void
}) {
  const Dialog = kind === 'feedback' ? FeedbackDialog : OtherPlatformsDialog
  return <Suspense fallback={null}><Dialog onClose={onClose} /></Suspense>
}
