import { useEffect, useId, useState } from 'react'
import { useLanguage } from '../i18n'
import { CloudHttpError, type CloudClient } from './client'
import { cloudLimits, type CloudEntry } from './contracts'
import { CloudLibraryButton } from './CloudLibraryButton'
import './cloud-panel.css'

export interface CloudSaveSelection {
  api: CloudClient
  accountId: string
  entry?: CloudEntry
  full: boolean
}

export function CloudSavePicker({ api, accountId, disabled, onSelect }: {
  api: CloudClient; accountId: string; disabled: boolean; onSelect: (value: CloudSaveSelection | undefined) => void
}) {
  const language = useLanguage(), text = (en: string, ja: string) => language === 'ja' ? ja : en
  const radioName = useId()
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ api: CloudClient; accountId: string; attempt: number; entries: CloudEntry[]; error?: 'auth' | 'unavailable' }>()
  const [selected, setSelected] = useState<string>()
  const [query, setQuery] = useState(''), [sort, setSort] = useState<'updated' | 'name'>('updated')
  const loading = !result || result.api !== api || result.accountId !== accountId || result.attempt !== reload
  const entries = loading ? [] : result.entries
  const error = loading ? undefined : result.error
  const choose = (entry?: CloudEntry) => {
    setSelected(entry?.id ?? 'new')
    onSelect({ api, accountId, entry, full: entries.length >= cloudLimits.records })
  }
  useEffect(() => {
    let active = true
    void api.listTopologies().then(entries => {
      if (!active) return
      setResult({ api, accountId, attempt: reload, entries })
      if (!reload && entries.length < cloudLimits.records) {
        setSelected('new'); onSelect({ api, accountId, full: false })
      }
    }).catch(failure => {
      if (!active) return
      const auth = failure instanceof CloudHttpError && [401, 403].includes(failure.status)
      setResult({ api, accountId, attempt: reload, entries: [], error: auth ? 'auth' : 'unavailable' })
      if (!reload && !auth) { setSelected('new'); onSelect({ api, accountId, full: false }) }
    })
    return () => { active = false }
  }, [api, accountId, reload, onSelect])
  const matching = entries.filter(entry => entry.name.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, language)
      : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)) || a.id.localeCompare(b.id))
  const full = entries.length >= cloudLimits.records
  return <fieldset className="cloud-save-picker" disabled={disabled}>
    <legend>{text('Choose a cloud destination', 'クラウドの保存先を選択')}</legend>
    <label className="cloud-save-select"><input type="radio" name={radioName} checked={selected === 'new'} disabled={loading || full || error === 'auth'}
      onChange={() => choose()} />{text('Save new cloud topology', '新しいクラウドのトポロジとして保存')}</label>
    {full && <p>{text('The cloud library is full. Select an existing save to overwrite, or free space in the cloud library.',
      'クラウド ライブラリがいっぱいです。既存の保存を選んで上書きするか、ライブラリの空きを確保してください。')}</p>}
    <button type="button" disabled={disabled || loading} onClick={() => {
      setSelected(undefined); onSelect(undefined); setReload(value => value + 1)
    }}>
      {text('Refresh cloud destinations', 'クラウドの保存先を更新')}
    </button>
    {loading && <p role="status">{text('Loading cloud saves...', 'クラウドの保存を読み込み中...')}</p>}
    {error && <p role="alert">{error === 'auth'
      ? text('Sign in again to list your cloud saves.', 'クラウドの保存を一覧表示するには再サインインしてください。')
      : text('Cloud saves could not be listed. Retry when connected; this is not an empty library.',
        'クラウドの保存の一覧を取得できません。接続後に再試行してください。空のライブラリという意味ではありません。')}</p>}
    {!loading && !error && !entries.length && <p>{text('No cloud saves yet. Choose Save new.', 'クラウドの保存はありません。新しい保存を選択してください。')}</p>}
    {!!entries.length && <>
      <div className="cloud-library-tools">
        <label>{text('Find cloud saves', 'クラウドの保存を検索')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>{text('Sort cloud saves', 'クラウドの保存の並べ替え')}<select value={sort} onChange={event => setSort(event.target.value as 'updated' | 'name')}>
          <option value="updated">{text('Recently updated', '更新日時が新しい順')}</option>
          <option value="name">{text('Name', '名前順')}</option>
        </select></label>
      </div>
      <p role="status">{text(`${matching.length} of ${entries.length} cloud saves`, `${entries.length} 件中 ${matching.length} 件の保存`)}</p>
      {!matching.length && <p>{text('No matching cloud saves. Change your search.', '一致する保存はありません。検索条件を変更してください。')}</p>}
      <div className="cloud-library-scroll" tabIndex={0} role="region" aria-label={text('Cloud destinations', 'クラウドの保存先')}>
        <table className="cloud-library" role="table">
          <thead><tr role="row"><th scope="col">{text('Choose', '選択')}</th><th scope="col">{text('Cloud save', 'クラウドの保存')}</th><th scope="col">{text('Last updated', '最終更新')}</th></tr></thead>
          <tbody>{matching.map(entry => <tr role="row" key={entry.id} data-cloud-save-id={entry.id}>
            <td><label className="cloud-save-select"><input type="radio" name={radioName} checked={selected === entry.id} disabled={loading}
              aria-label={`${text('Overwrite cloud save', 'クラウドの保存を上書き')} ${entry.name} (${entry.id})`} onChange={() => choose(entry)} /></label></td>
            <th scope="row"><CloudLibraryButton className="cloud-entry-name" aria-label={`${text('Cloud save details', 'クラウドの保存の詳細')} ${entry.name} (${entry.id})`}
              hint={`${entry.name}\n${entry.description || text('No description', '説明なし')}`}>{entry.name}</CloudLibraryButton>
              <small>{text('Save ID', '保存 ID')}: {entry.id}</small></th>
            <td><time dateTime={entry.updatedAt || undefined}>{Number.isNaN(Date.parse(entry.updatedAt))
              ? text('Not available', '不明') : new Date(entry.updatedAt).toLocaleString(language)}</time></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </fieldset>
}
