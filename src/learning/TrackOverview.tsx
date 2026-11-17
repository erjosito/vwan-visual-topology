import { useLanguage } from '../i18n'
import { text } from './content'
import { learningTracks, trackLabels as labels } from './tracks'
import './learning-tracks.css'

export function TrackOverview() {
  const language = useLanguage()
  return <details className="learning-tracks" data-testid="learning-tracks">
    <summary>{text(labels.overview, language)}</summary>
    <ul>
      {learningTracks.filter((track) => track.status === 'available').map((track) => <li key={track.id}>
        <strong>{text(track.title, language)}</strong> - {text(labels.available, language)}
        <p>{text(track.summary, language)}</p>
      </li>)}
    </ul>
    <section aria-label={text(labels.plannedTracks, language)}>
      <h3>{text(labels.plannedTracks, language)}</h3>
      <ul>{learningTracks.filter((track) => track.status === 'planned').map((track) => <li key={track.id}>
        <strong>{text(track.title, language)}</strong> - {text(labels.planned, language)}
        <p>{text(track.summary, language)}</p>
      </li>)}</ul>
      <p>{text(labels.plannedNotice, language)}</p>
    </section>
    <p>{text(labels.scope, language)}</p>
  </details>
}
