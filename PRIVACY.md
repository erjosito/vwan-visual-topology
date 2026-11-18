# Privacy policy

Last updated: 17 November 2026

## Scope and maintainer

This policy describes the Azure Network Simulator (AzNetSim; formerly Virtual WAN Topology Lab)
web application, Windows desktop application, and optional local MCP server
maintained in [erjosito/vwan-visual-topology](https://github.com/erjosito/vwan-visual-topology).
This is an independent project, not an official Microsoft product or service.

## Local simulation and storage

Topology editing, routing simulation, diagnostics, explanations, and practice
assessment run on your device. These features do not require a project account
or send your topology, imported captures, simulation results, or practice
progress to the maintainer. The application does not include advertising,
behavioral analytics, telemetry, or automatic crash-report uploads.

The application uses local browser storage for saved designs, recovery copies,
preferences, and practice progress. Web storage is separate for each website
origin, including `vwan-simulator.com` and `aznet-simulator.com`. Feedback drafts
use browser session storage. The Windows application stores its local data in
its Electron user-data profile under your Windows account.

Saved designs, captures, exports, and local progress are not encrypted by the
application. They can contain sensitive addresses, resource identifiers,
configuration, and text you enter. Device permissions, disk encryption,
browser settings, backups, and synchronization services are under your control.

## Website visits and downloads

Using the web application requires downloading its pages and assets from Azure
Static Web Apps. Visiting this repository or downloading a release from GitHub
also contacts GitHub. Those providers receive normal connection information,
such as your IP address and requested URL, and may process request metadata for
delivery, security, and service operations. Local simulation does not imply
anonymous website access.

The application does not set advertising or analytics cookies. Hosting
providers and external websites may use their own cookies and logs. Their
processing and retention are governed by their own policies:
[Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
and [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Optional actions that share information

- **Feedback and issues:** The web feedback feature opens a pre-filled issue
  form on GitHub after you choose to continue. The URL includes your entered
  category, title and description, the application revision, and a generated
  report reference. GitHub receives those values when the form opens; submitting
  the issue publishes them with your GitHub identity. No topology, screenshot,
  configuration, or browser log is automatically attached. Do not include
  secrets or confidential information.
- **Share links and exports:** A web share link contains a topology snapshot in
  its URL fragment. It is not encrypted or redacted; anyone with the link can
  read the design. The fragment is not sent in the normal HTTP request, but the
  link can be exposed through your clipboard, browser history or synchronization,
  and any service or person with whom you share it. Exported JSON, reports,
  diagrams, and Bicep files may also contain sensitive information. Saving them
  to a synchronized or network folder can transmit them through that service.
- **Azure collection:** Only when you deliberately use the optional collector
  scripts or desktop Azure collection controls do they use your local Azure CLI
  session to read your selected Azure scope. These operations can contact Azure
  identity and management services. Captures remain local and are not uploaded
  to the maintainer. Removal of known credential fields is not a guarantee of
  anonymization; review captures before sharing.
- **MCP and AI clients:** The optional MCP server communicates locally over
  standard input/output. Your selected AI client or provider may receive the
  topology inputs and tool results it uses. Its privacy, retention, and
  organizational policies apply; a local MCP server does not make a hosted AI
  service offline.
- **External links:** Opening documentation, facility websites, or other
  external links in the web application contacts the selected service, whose
  privacy policy applies.

## Windows desktop network behavior

The packaged desktop application loads bundled assets and blocks external
renderer requests and navigation. It has no automatic updater, background
release check, telemetry, or crash uploads. Web feedback and share-link features
are disabled. Explicit Azure CLI collection is a separate, user-initiated network
operation as described above.

Windows, browsers, antivirus software, and certificate validation services may
independently contact their providers when downloading, checking, installing,
or running software. This policy does not describe those providers' operations.

## Retention and deletion

Local saved data remains until you remove it or your browser or operating system
clears it. Clearing a visible workspace may leave recovery copies, preferences,
or practice data. To remove all web application storage, clear site data for
each origin you used. To remove desktop saved data, close the application and
remove its product-specific user-data profile. Do not assume uninstalling the
application removes that profile.

Feedback drafts are removed from session storage when you discard them or open
the GitHub issue form. Desktop collection attempts remove their temporary
capture directory on completion or failure, but a crash or forced termination
can leave temporary files behind. Delete exports, backups, synchronized copies,
and residual temporary captures separately when needed.

The maintainer cannot access or erase data held only on your device. Information
you publish on GitHub or send to an external provider is subject to that
provider's retention and deletion procedures.

## Questions and changes

For general privacy questions, contact the maintainer through the
[project's GitHub issues](https://github.com/erjosito/vwan-visual-topology/issues).
Issues are public: do not post personal data, credentials, or confidential
captures. For private concerns, use a private contact method explicitly
published on the [maintainer's GitHub profile](https://github.com/erjosito),
if available.

Changes to this policy will be recorded in this file and its Git history.
Review the policy for the version of the application you use.
