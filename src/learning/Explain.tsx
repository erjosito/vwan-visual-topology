import { useLanguage, localizeDiagnostic } from '../i18n'
import { concepts, labels, text } from './content'
import type { ConceptId } from './content'
import './learning.css'

export function Explain({ concept, evidence = [] }: { concept: ConceptId; evidence?: readonly string[] }) {
  const language = useLanguage()
  const content = concepts[concept]
  return <details className="learning-explain" data-concept={concept}>
    <summary>{text(labels.explain, language)} · {text(content.title, language)}</summary>
    <p>{text(content.body, language)}</p>
    {evidence.length ? <>
      <strong>{text(labels.evidence, language)}</strong>
      <ul>{[...new Set(evidence)].map((reason) => <li key={reason}>{localizeDiagnostic(reason, language)}</li>)}</ul>
    </> : <p>{text(labels.noEvidence, language)}</p>}
    <p>{text(labels.snapshot, language)}</p>
    <a href={content.source} target="_blank" rel="noopener noreferrer">{text(labels.source, language)}</a>
  </details>
}
