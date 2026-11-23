import { useEffect, useRef } from 'react'
import { useLanguage } from './i18n'
import { platformLinks } from './platform-links'

export default function OtherPlatformsDialog({ onClose }: { onClose: () => void }) {
  const language = useLanguage(), text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="object-dialog" aria-labelledby="other-platforms-title" onClose={onClose}>
    <h2 id="other-platforms-title">{text('Use AzNetSim elsewhere', 'ほかの環境で AzNetSim を使う')}</h2>
    <button type="button" autoFocus onClick={onClose}>{text('Close', '閉じる')}</button>
    <p>{text('Optional local clients use the same simulation engines. This browser and your current design stay open; no sign-in or download is required.',
      '同じシミュレーション エンジンを使う任意のローカル クライアントです。このブラウザーと現在のデザインは開いたままです。サインインやダウンロードは不要です。')}</p>
    <section>
      <h3>{text('Windows app', 'Windows アプリ')}</h3>
      <p>{text('A standalone desktop workspace. Open the published installer release page, then choose whether to download. The development installer is unsigned; there is no Microsoft Store listing or automatic updater.',
        '単独で動作するデスクトップ ワークスペースです。公開済みインストーラーのリリース ページを開き、必要に応じてダウンロードしてください。開発版は未署名です。Microsoft Store での提供や自動更新には対応していません。')}</p>
      <button type="button" onClick={() => window.open(platformLinks.windows, '_blank', 'noopener,noreferrer')}>
        {text('Windows app - downloads', 'Windows アプリ - ダウンロード')}
      </button>
    </section>
    <section>
      <h3>{text('Local MCP server', 'ローカル MCP サーバー')}</h3>
      <p>{text('Use the simulator from a compatible AI client. Setup covers Node 22+, the portable package or source checkout, client configuration, restarting after updates and a first simulation. Your AI provider may receive tool inputs and results; local MCP does not make hosted AI offline.',
        '対応する AI クライアントから利用できます。Node 22 以降、ポータブル パッケージまたはソースからの導入、クライアント設定、更新後の再起動、最初のシミュレーションを説明しています。ツールの入力や結果は AI プロバイダーに送信される場合があります。ローカル MCP でもホスト型 AI がオフラインになるわけではありません。')}</p>
      <button type="button" onClick={() => window.open(platformLinks.mcp, '_blank', 'noopener,noreferrer')}>
        {text('MCP server - install and use', 'MCP サーバー - 導入と使い方')}
      </button>
    </section>
  </dialog>
}
