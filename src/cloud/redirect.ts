import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'

void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'Sign-in could not return to the simulator. Close this window and try again from the app.'
})
