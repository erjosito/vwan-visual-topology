// Blocking head script: resolve the ThemeSelector preference before styles or React paint.
(() => {
  let preference = 'system'
  try { preference = localStorage.getItem('aznet-theme') || 'system' } catch {}
  const theme = preference === 'light' || preference === 'dark'
    ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
})()
