import type { Localized } from './content'
import type { Requirement } from '../platform/contract'

export const runnerLabels = {
  preview: { en: 'Two assessed lessons are available. The complete white-to-black-belt curriculum is still being developed.', ja: '評価付きの 2 レッスンを利用できます。白帯から黒帯までの全カリキュラムは開発中です。' },
  session: { en: 'Task completion stays in this open app session for now. Your practice canvas is saved separately in this browser.', ja: '現在、タスクの完了はこのアプリのセッション内に保持されます。練習キャンバスはこのブラウザーに別途保存されます。' },
  check: { en: 'Check task', ja: 'タスクを確認' },
  checking: { en: 'Checking current canvas...', ja: '現在のキャンバスを確認中...' },
  continue: { en: 'Complete task & continue', ja: 'タスクを完了して続ける' },
  cancel: { en: 'Cancel check', ja: '確認をキャンセル' },
  passed: { en: 'The current check passed. Continue to record completion and unlock the next task.', ja: '現在の確認に合格しました。続行すると完了が記録され、次のタスクが解除されます。' },
  scope: { en: 'Open this lesson’s protected practice canvas first. Normal designs and other scenarios cannot satisfy this task.', ja: '先にこのレッスンの保護された練習キャンバスを開いてください。通常の設計や別のシナリオでは達成できません。' },
  inspect: { en: 'Inspect the requested subnet and prefix, then use Record inspection inside its effective-routes inspector. Show me where is navigation help, not evidence.', ja: '指定されたサブネットとプレフィックスを調べ、有効なルートの画面で「確認を記録」を押してください。「場所を表示」は案内であり、根拠ではありません。' },
  observed: { en: 'Inspection recorded for this task and canvas revision. Check the task to continue.', ja: 'このタスクとキャンバスのリビジョンの確認を記録しました。タスクを確認して続けてください。' },
  peering: { en: 'Create a direct enabled peering between the requested VNets, allowing virtual network access in both directions. An unrelated peering or a disabled direction does not meet this skill check.', ja: '指定された VNet 間に直接ピアリングを作成して有効にし、両方向の仮想ネットワーク アクセスを許可してください。別のピアリングや無効な方向では達成できません。' },
  requirements: { en: 'The current configuration does not yet meet these networking conditions:', ja: '現在の構成は次のネットワーク条件をまだ満たしていません:' },
  answer: { en: 'Choose an answer before checking. You can retry without losing points.', ja: '確認前に回答を選んでください。ポイントを失わずに再試行できます。' },
  incorrect: { en: 'Not yet. Read the feedback and try again; retries never cost points.', ja: 'まだ正解ではありません。説明を読んで再試行してください。ポイントは減りません。' },
  unassessed: { en: 'This check could not be fully assessed. Nothing was completed. Check the current canvas, retry, or explicitly reload the starter. Unsupported or incomplete results never pass.', ja: 'この確認を完全に評価できませんでした。完了は記録されていません。キャンバスを確認し、再試行するか初期構成を明示的に再読み込みしてください。未対応や不完全な結果では合格しません。' },
  stale: { en: 'The canvas or practice session changed. Check again; previous evidence is no longer current.', ja: 'キャンバスまたは練習セッションが変わりました。以前の根拠は現在のものではないため、再確認してください。' },
  cancelled: { en: 'Check paused. No pending result can complete this task. Check again when ready.', ja: '確認を一時停止しました。保留中の結果ではこのタスクを完了できません。準備ができたら再確認してください。' },
  review: { en: 'Reviewing historical completion. This does not certify the current canvas or earn points again.', ja: '過去の完了を復習しています。現在のキャンバスの検証やポイントの再獲得ではありません。' },
  return: { en: 'Return to current task', ja: '現在のタスクに戻る' },
  replay: { en: 'Replay this lesson', ja: 'このレッスンを再練習' },
  replayNotice: { en: 'Replay starts at the first task without deleting past completion. Loading the starter still needs confirmation. No repeat credit is awarded.', ja: '過去の完了を削除せず、最初のタスクから再練習します。初期構成の読み込みには引き続き確認が必要です。重複したポイントは付与しません。' },
  replayConfirm: { en: 'Start lesson replay', ja: 'レッスンの再練習を開始' },
  replaying: { en: 'Replaying this lesson. Past completion is preserved.', ja: 'このレッスンを再練習中です。過去の完了は保持されます。' },
  done: { en: 'Available lessons complete', ja: '利用可能なレッスンを完了' },
  doneDetail: { en: 'You completed both assessed examples. Review or replay to practice again. This is not a black-belt qualification or an Azure certification.', ja: '評価付きの 2 つの例を完了しました。復習や再練習を利用できます。黒帯の資格や Azure 認定ではありません。' },
  outline: { en: 'Learning path and completed-task review', ja: '学習の順序と完了したタスクの復習' },
  completed: { en: 'Completed', ja: '完了' },
  locked: { en: 'Locked', ja: 'ロック中' },
  current: { en: 'Current task', ja: '現在のタスク' },
  points: { en: 'points', ja: 'ポイント' },
} satisfies Record<string, Localized>

export function requirementDescription(requirement: Requirement): Localized {
  if (requirement.kind === 'route') return {
    en: `The exact route ${requirement.prefix} must be ${requirement.expectation === 'present' ? 'present' : 'absent'} in the requested route table.`,
    ja: `指定されたルート テーブルで完全一致の ${requirement.prefix} が${requirement.expectation === 'present' ? '存在する' : '存在しない'}必要があります。`,
  }
  if (requirement.kind === 'flow') return {
    en: `${requirement.sourceAddress} to ${requirement.destinationAddress}: the modeled forward and return paths must ${requirement.expectation === 'allow' ? 'allow traffic' : 'demonstrate the requested block'}.`,
    ja: `${requirement.sourceAddress} から ${requirement.destinationAddress}: モデルの往路と復路で${requirement.expectation === 'allow' ? '通信が許可される' : '指定された遮断が確認される'}必要があります。`,
  }
  return { en: 'The requested packet-routing condition must be fully assessed and satisfied.', ja: '指定されたパケット ルーティング条件が完全に評価され、満たされる必要があります。' }
}
