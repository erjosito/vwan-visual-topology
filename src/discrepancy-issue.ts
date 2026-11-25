export function discrepancyIssueUrl(): string {
  const body = '### Azure discrepancy\n\nDescribe the unexpected result here.\n\n'
    + '### Offline reproduction\n\nAttach the reviewed aznetsim-discrepancy.zip downloaded from Azure files. '
    + 'It contains the description, topology, available Azure evidence and app provenance. '
    + 'Review resource identifiers, names and network addresses before posting publicly.\n\n'
    + 'The bundle is historical evidence, not live Azure validation.'
  return `https://github.com/erjosito/vwan-visual-topology/issues/new?${new URLSearchParams({ title: 'Azure simulator discrepancy', body })}`
}
