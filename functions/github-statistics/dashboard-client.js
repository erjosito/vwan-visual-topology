const element = (id) => document.getElementById(id)
const number = (value) => value === null || value === undefined ? 'Not measured' : new Intl.NumberFormat().format(value)
const utc = (value) => value ? new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Baseline'
const dayMs = 86_400_000
const webNumber = (value) => value === null || value === undefined ? 'Unavailable' : number(value)
const bytes = (value) => value === null || value === undefined ? 'Unavailable'
  : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value / 1_048_576)} MiB`
let summary

function row(target, cells) {
  const tr = document.createElement('tr')
  for (const [index, value] of cells.entries()) {
    const td = document.createElement('td')
    td.textContent = value
    if (target === 'release-rows' && index === 1) td.className = 'asset'
    tr.append(td)
  }
  element(target).append(tr)
}

function card(label, value, detail, target = 'cards', format = number) {
  const article = document.createElement('article')
  const title = document.createElement('span')
  title.textContent = label
  const count = document.createElement('strong')
  count.textContent = format(value)
  const note = document.createElement('span')
  note.textContent = detail
  article.append(title, count, note)
  element(target).append(article)
}

function chart(target, rows, metrics, label) {
  const host = element(target)
  host.replaceChildren()
  if (!rows.some((entry) => metrics.some(({ key }) => entry[key] !== null && entry[key] !== undefined))) {
    const message = document.createElement('p')
    message.textContent = 'No comparable observations in this period.'
    host.append(message)
    return
  }
  const create = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
    return node
  }
  const svg = create('svg', { viewBox: '0 0 720 200', role: 'img', 'aria-label': label })
  const max = Math.max(1, ...rows.flatMap((entry) => metrics.map(({ key }) => entry[key] ?? 0)))
  const firstDay = Date.parse(rows[0].date)
  const span = Math.max(dayMs, Date.parse(rows.at(-1).date) - firstDay)
  const x = (index) => 55 + (Date.parse(rows[index].date) - firstDay) / span * 640
  const y = (value) => 163 - value / max * 135
  for (const value of [0, max]) {
    svg.append(create('line', { x1: 55, x2: 695, y1: y(value), y2: y(value), stroke: '#34445d' }))
    const text = create('text', { x: 45, y: y(value) + 4, 'text-anchor': 'end' })
    text.textContent = number(value)
    svg.append(text)
  }
  for (const [index, anchor] of rows.length === 1 ? [[0, 'start']] : [[0, 'start'], [rows.length - 1, 'end']]) {
    const text = create('text', { x: x(index), y: 190, 'text-anchor': anchor })
    text.textContent = rows[index].date
    svg.append(text)
  }
  for (const { key, color } of metrics) {
    let path = ''
    let connected = false
    let previousDate
    for (const [index, entry] of rows.entries()) {
      const value = entry[key]
      if (value === null || value === undefined) { connected = false; continue }
      if (previousDate && Date.parse(entry.date) - Date.parse(previousDate) > dayMs) connected = false
      path += `${connected ? 'L' : 'M'}${x(index)},${y(value)} `
      svg.append(create('circle', { cx: x(index), cy: y(value), r: 3, fill: color }))
      connected = true
      previousDate = entry.date
    }
    svg.append(create('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2 }))
  }
  host.append(svg)
}

function renderHistory() {
  const cutoff = new Date(Date.now() - Number(element('range').value) * dayMs).toISOString().slice(0, 10)
  const traffic = summary.trafficDays.filter(({ date }) => date >= cutoff)
  const downloads = summary.series.filter(({ date }) => date >= cutoff)
  const web = (summary.web?.days ?? []).filter(({ date }) => date >= cutoff)
  for (const id of ['web-cards', 'web-rows']) element(id).replaceChildren()
  for (const [key, title, format] of [
    ['hits', 'Web site hits', webNumber], ['bytesSent', 'Web data out', bytes], ['errors', 'Reported site errors', webNumber],
  ]) {
    const measured = web.filter((entry) => entry[key] !== null && entry[key] !== undefined)
    card(title, measured.length ? measured.reduce((sum, entry) => sum + entry[key], 0) : null,
      `${measured.length}/${element('range').value} UTC days measured; total of available samples`, 'web-cards', format)
  }
  element('web-status').textContent = summary.web?.status === 'available'
    ? `Source: ${summary.web.resourceName}. Last platform collection: ${utc(summary.web.collectedAt)}. Completed UTC days only; missing samples are unavailable, not zero.`
    : 'Static Web App metrics have not been collected yet.'
  element('web-status').classList.toggle('warning', summary.web?.status === 'available'
    && Date.now() - Date.parse(summary.web.collectedAt) > 36 * 3_600_000)
  chart('web-hits-chart', web, [{ key: 'hits', color: '#8ecaff' }], 'Daily Static Web App site hits, not users or sessions.')
  chart('web-bytes-chart', web.map((entry) => ({
    date: entry.date, mib: entry.bytesSent === null || entry.bytesSent === undefined ? null : entry.bytesSent / 1_048_576,
  })), [{ key: 'mib', color: '#8de0c2' }], 'Daily Static Web App outgoing data in MiB.')
  for (const entry of [...web].reverse()) {
    row('web-rows', [entry.date, webNumber(entry.hits), bytes(entry.bytesSent), webNumber(entry.errors)])
  }
  for (const id of ['traffic-rows', 'download-rows']) element(id).replaceChildren()
  chart('traffic-chart', traffic.map((entry) => ({ date: entry.date, views: entry.views?.count, clones: entry.clones?.count })), [
    { key: 'views', color: '#8ecaff' }, { key: 'clones', color: '#8de0c2' },
  ], 'Daily GitHub repository views and clones; exact values are in the following table.')
  chart('download-chart', downloads, [{ key: 'growth', color: '#8ecaff' }], 'Observed download growth between collections; intervals and values are in the following table.')
  for (const entry of [...traffic].reverse()) {
    row('traffic-rows', [
      entry.date + (entry.partial ? ' (partial)' : ''),
      number(entry.views?.count), number(entry.views?.uniques),
      number(entry.clones?.count), number(entry.clones?.uniques),
    ])
  }
  for (const entry of [...downloads].reverse()) {
    row('download-rows', [
      utc(entry.observedAt), number(entry.downloads), number(entry.growth),
      utc(entry.intervalStart), `${entry.baselines} / ${entry.resets}`,
    ])
  }
}

async function load() {
  try {
    const response = await fetch('/api/statistics/summary', {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' },
    })
    if (response.status === 403) throw new Error('Your account is not approved to access this dashboard.')
    if (response.status === 503) throw new Error((await response.json()).error)
    if (!response.ok) throw new Error('The statistics service is unavailable. Try again later.')
    summary = await response.json()
    element('repository').textContent = `${summary.repository} - GitHub distribution and web hosting metrics`
    const age = Date.now() - Date.parse(summary.collectedAt)
    element('status').textContent = `Last successful collection: ${utc(summary.collectedAt)}${age > 36 * 3_600_000 ? ' - collection is overdue.' : ''}`
    element('status').classList.toggle('warning', age > 36 * 3_600_000)
    card('Asset downloads', summary.downloads, 'Cumulative, currently published assets')
    card('Stars', summary.repositoryCounters.stars, 'Point-in-time counter')
    card('Forks', summary.repositoryCounters.forks, 'Point-in-time counter')
    const traffic = summary.traffic
    card('Repository views', traffic.views?.count, 'GitHub API window, up to 14 days')
    card('Unique visitors', traffic.views?.uniques, 'Unique only within that API window')
    card('Repository clones', traffic.clones?.count, 'GitHub API window, up to 14 days')
    card('Unique cloners', traffic.clones?.uniques, 'Unique only within that API window')
    element('coverage').textContent = `Archive coverage shown since ${summary.historyStart.slice(0, 10)} (up to 366 days). Traffic can include GitHub's preceding 14 days.`
    for (const release of summary.releases) {
      for (const asset of release.assets) {
        row('release-rows', [`${release.tag}${release.prerelease ? ' (prerelease)' : ''}`, asset.name, number(asset.downloads)])
      }
    }
    element('dashboard').hidden = false
    renderHistory()
    element('range').addEventListener('change', renderHistory)
  } catch (error) {
    element('status').textContent = error instanceof TypeError
      ? 'Could not load the dashboard. Your sign-in may have expired; sign in again or retry later.'
      : error.message
    element('status').classList.add('warning')
    element('signin').hidden = false
  }
}

load()
