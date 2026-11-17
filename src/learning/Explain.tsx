import { useState } from 'react'
import { useLanguage, localizeDiagnostic } from '../i18n'
import { concepts, labels, text } from './content'
import type { ConceptId } from './content'
import './learning.css'

export function Explain({ concept, evidence = [] }: { concept: ConceptId; evidence?: readonly string[] }) {
  const language = useLanguage()
  const content = concepts[concept]
  const [bodies, setBodies] = useState<typeof import('./concept-bodies').conceptBodies>()
  const [failed, setFailed] = useState(false)
  return <details className="learning-explain" data-concept={concept} onToggle={(event) => {
    if (event.currentTarget.open && !bodies) void import('./concept-bodies').then(
      ({ conceptBodies }) => setBodies(conceptBodies), () => setFailed(true))
  }}>
    <summary>{text(labels.explain, language)} · {text(content.title, language)}</summary>
    <p>{bodies ? text(bodies[concept], language) : failed
      ? language === 'ja' ? '説明を読み込めません。再読み込みして再試行してください。' : 'Explanation could not load. Reload to retry.'
      : language === 'ja' ? '説明を読み込み中...' : 'Loading explanation...'}</p>
    {evidence.length ? <>
      <strong>{text(labels.evidence, language)}</strong>
      <ul>{[...new Set(evidence)].map((reason) => <li key={reason}>{localizeDiagnostic(reason, language)}</li>)}</ul>
    </> : <p>{text(labels.noEvidence, language)}</p>}
    <p>{text(labels.snapshot, language)}</p>
    <a href={content.source} target="_blank" rel="noopener noreferrer">{text(labels.source, language)}</a>
  </details>
}
