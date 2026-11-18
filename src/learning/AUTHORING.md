# Guided course authoring contract

The `course-*` files define declarative content (#179); importing them does not
execute tasks. The protected canvas (#182), non-modal sidebar/guidance (#178)
and evidence-gated runner (#180) activate sequential assessed missions.
The original edition has 40 tasks across six missions and 1,325 points; the
scenario edition has 41 tasks across eight missions and 1,575 points through
black belt, with its own thresholds and mastery checkpoints.
The root owns the runner across editor switches and pause/resume. A bounded
browser-local ledger (#183) restores compatible completions after reload and
derives first-earned points, checkpoint-gated belts and the header status.
The curriculum is authored under #184. No legacy JSON draft, raw requirements or
engine payload is shown; legacy storage stays untouched.

## Track scope and compatibility

The playable track is displayed as **Routing foundations**. Its historical
`azure-networking-preview` course ID, content version 4, award/check identities,
40 tasks, 1,325 points and stored practice/progress formats remain unchanged.
Renaming the presentation is not a migration or a grading revision.
`tracks.ts` is a small declarative catalog; **DNS and name resolution** and
**Application delivery** are **Planned** informational entries, with no course
binding, points, unlocks or start actions. `TrackOverview` is shared by the
on-demand status details and sidebar. The eager header uses only lightweight
course metadata; it must not import the catalog or overview.

The new header shows the highest checkpoint-qualified belt across published
editions, independent of enrollment. Editions with the same `trackId` count
once; an `xN` suffix appears only when multiple distinct tracks share that
highest belt. Planned tracks and unknown course completions do not count.
The tooltip/accessibility label explains the track count; status details
retain the selected edition's separate belt and points.

Belts describe completion of a track's published curriculum, not all Azure
networking or professional certification. Available-course denominators and
XP exclude planned tracks; future tracks must use their own course identity.
Existing first awards and recorded content/assessment versions remain intact.
Future additions need an explicit compatibility review: expose compatible new
material as new modules, or scope incompatible belt requirements to a separate
extension/edition while retaining historic achievements. Do not silently change
published thresholds/checkpoints and thereby revoke an earned belt. This slice
adds no automatic historical credit. For the beta HA extension (#222), the user
explicitly waived preservation of previous curriculum sessions. Scenario content
version 2 therefore extends the existing course rather than creating another
edition or session migration: all earlier task/award IDs and first-earned points
stay unchanged; the new six-task HA mission adds 250 points. The current black-belt
requirement is now 1,575 points plus the HA explanation checkpoint. Earlier
completion records are not deleted or rewritten, but do not grant HA credit.
Normal saved designs remain protected. This is an explicit beta exception to the
published-threshold policy above, not a general migration policy.

`editions.ts` is the lightweight edition catalog. Fresh learners start
`azure-routing-scenarios` version 2. Historical original-course completions
retain the original edition unless the learner explicitly opts in through
**Curriculum editions** or header status details. A retained original practice
canvas also retains its edition when no enrollment/history selects otherwise.
The optional `enrollment` field extends the existing v1 ledger; old backups
remain readable. Enrollment uses the same exclusive writer/CAS protection as
awards. Switching editions neither loads a starter nor rewrites achievements.
The original belt and points remain visible separately after opting in, and
switching back restores the original journey. Reset explicitly clears both
editions' progress; it is not an edition-switch mechanism.

`runner.ts` is the single progression authority. Supported check kinds dispatch
to reusable checks, never lesson-ID branches. A passing candidate is bound to
course/content/task/assessment identity, runtime session, practice scope and a
monotonic live-editor revision. **Complete task & continue** rechecks that binding,
records one scoped completion event and unlocks the next unmet task. Edits
(including edit/undo), replacement, provider/active-practice changes, cancellation,
review and replay cannot reuse pending or previous evidence. Shared-worker
requirements must have an exact, complete assessment set; unknown, unsupported,
failed or cancelled evaluation never passes.

**Show me where** is not observation evidence. The exact native subnet inspector
offers **Record inspection: prefix** only for the current scoped observation
request. Its short-lived token is task/session/revision-specific; repeated use of
the same check definition in another task requires a new observation. Quizzes
separately check interpretation with answer-specific feedback and free retries.
Past completion does not certify the current canvas. Completed tasks can be
reviewed, future tasks remain locked, and explicit lesson replay rechecks each
step without deleting history or emitting repeat completion credit.

The root's `openPractice({ courseId, scenarioId, document }, signal)` session API
accepts a copied native scenario after explicit confirmation; it does not look
up lesson names or hardcode the curriculum. Opening/selecting lesson content must
not invoke it implicitly. Resume the existing canvas instead of loading its
starter again. `practice-workspace.ts` owns the separate canvas envelope; it is
not the course progress/award ledger. `practice-session.ts` loads only when
practice exists or is explicitly started, keeping the controller and full course
off the normal startup asset graph. The header reads only lightweight course
metadata and the local ledger; details and concept bodies load on demand.
See `PLATFORM.md` for exact persistence,
return, recovery and same-session history behavior.

## What goes where

| File | Edit for |
| --- | --- |
| `course-outline.ts` | Full journey objectives and reviewed point budgets |
| `course-profile.ts` | Lightweight course identity, order, belts/thresholds and checkpoint assessment identities shared with the header |
| `course-examples.ts` | The original two localized missions and central content assembly; historical export name retained |
| `course-routing.ts` | Localized longest-prefix and gateway-return missions, checks and guidance |
| `course-wan.ts` | Localized secured-WAN and hybrid-capstone missions, checks and guidance |
| `course-scenarios.ts` | Native starter documents; copy before editing |
| `editions.ts` | Lightweight edition identities, scenario order, belts and cumulative mastery checkpoints |
| `scenario-course.ts` | Localized scenario objectives, balanced diagnostic choices, requirements and native guidance |
| `scenario-topologies.ts` | Independent original scenario-edition starter documents |
| `scenario-course.test.ts` | Actual-engine starter failures, valid repairs, preserved witnesses and independent faults |
| `course-contract.ts` | A genuinely new reusable task/check/action shape |
| `course-validation.ts` | Validation for a new shape/scope, not individual lesson IDs |
| `course.test.ts` | Content validation and real-engine failure/solution fixtures |
| `runner.ts`, `runner.test.ts` | Reusable progression, current-revision checks, completion events and cancellation |
| `progress-ledger.ts`, `progress-ledger.test.ts` | Bounded local completion history, compatible first awards, points/belt derivation and storage recovery |
| `practice-ownership.ts` | Exclusive origin-wide practice/award writer ownership |
| `content.ts`, `concept-bodies.ts` | Concept summaries/references and lazily loaded explanation bodies |

Use declarative TypeScript data and the existing `{ en, ja }` convention. No
callbacks, scripts, CSS selectors, translated-label matching or synthetic clicks.
The Zod discriminated unions are the typed registry of supported semantic check
and action IDs. `guidance.ts` resolves registered actions to scoped
semantic anchors; the mixed editor reveals them using its own selection,
route-inspection and context-menu handlers. `TopologyContextMenu` carries command
identity separately from translated labels. The sidebar has no lesson-specific
branches and executes no assessed edits. `GuidanceHighlight` outlines the exact
visible registered targets without touching routing/path classes. Missing or
disabled controls get a localized reason; closed/moved inspectors can be
revealed again explicitly. Adding a supported control requires its resolver,
native reveal adapter and anchor, never a lesson-specific sidebar branch.

## Scenario-edition ladder

| Mission | Points | Architecture and assessed repair |
| --- | ---: | --- |
| Private application link | 100 | Direct VNet peering; preserve local operations and restricted-network isolation |
| Inspection bypass | 125 | Delivered but uninspected traffic; longest-prefix steering in both directions |
| Co-located appliance chain | 200 | Firewall and SD-WAN in separate subnets of one hub; onward subnet policy |
| Dedicated appliance VNets | 250 | Firewall and SD-WAN in separate VNets; IP forwarding and independent return order |
| Branch advertisement | 200 | Gateway route propagation into workload subnets; learning versus attachment |
| WAN isolation | 200 | Exact hub-table evidence, connection propagation and positive/negative witnesses |
| Tiered incident | 250 | Indirect spoke with two independent faults; preserve the existing application conversation |
| HA return path | 250 | Tuple-preserving floating HA-ports steering, independently routed return, original backend and Operations witness |

Each mission is linear: explicitly load, inspect an exact starting scope,
repair an open networking requirement, inspect the independent return scope,
then explain a design/diagnostic decision. Task points are 5, 5,
`mission budget - 35`, 5 and 20. Thresholds are 0, 100, 225, 425, 675, 1075
and 1575; cumulative interpretation checkpoints gate each belt. Brown requires
both the branch and WAN missions; black also requires the HA explanation.
HA adds a 25-point packet diagnosis before repair, reducing its repair to 190
points. Its six tasks award 5, 5, 25, 190, 5 and 20 points respectively.

Native guidance can reveal VNet configuration (`network.configure`), an
associated UDR table including an empty one (`route-table.configure` without
`routeId`), hub configuration (`hub.configure`) or an exact hub route table
(`hub-routes.open`). `packet-probe.open` opens an owned VNet detail dialog and
highlights its native packet form, including inside the dialog top layer. It
does not select endpoints, submit a probe or modify the topology; learners
choose and run their own tuple and close the detail dialog to resume the lesson.
These actions locate controls without making repairs.
The existing exact-route action remains available when a specific row is
the intended observation. Requirements, not a prescribed edit sequence,
grade repairs. Preserve positive and isolation witnesses when adding cases.

Ordered chain checks require separately authored forward/reverse appliance
IDs. They assess complete modeled forwarding, not live security rules,
vendor overlay behavior, HA health/orchestration, convergence timing or
session failover. Missing/unknown owners and unsupported providers cannot
pass. Richer HA, BGP/export policies, subnet-scoped peering lessons and unsupported
WAN connection controls remain capability-gated follow-up work; these eight
cases do not claim exhaustive coverage of the book or blog.

Quiz options use authored order, comparable detail and grammatical structure,
and answer-specific explanations. Preserving old choice IDs preserves old
award/answer identities. Automated qualification is not an answer-blind SME
review and does not establish learning effectiveness.

## HA routing qualification (#222)

`tests/fixtures/ha-routing.ts` is an original two-NVA/ARS/branch fixture, not a
published mission. `ha-routing.test.ts` qualifies independent forward/return
paths, an unaffected local operations flow and invalid/unknown alternatives.
The original BGP qualification did not change curriculum awards. The bounded
HA-ports mission below now adds learner grading without publishing the broader
BGP withdrawal or controller mechanisms as working HA lessons.

| Mechanism | Qualified scope or remaining gate |
| --- | --- |
| Preferred/standby BGP advertisements | Shorter primary AS path, longer standby AS path; explicitly withdraw the primary branch advertisement and overlay, then verify both legs use the standby overlay. Restore is a new stateless snapshot, not measured failback. |
| Stale primary advertisement | An available alternate and a retained route are insufficient. Engine `2026.11.17.1` rejects delivery at an advertising NVA when a separately owned branch still needs a forwarding path. Abstract, unowned NVA-origin prefixes keep their existing behavior. |
| Manual UDR next-hop change | Equal-prefix User policy can still pin an NVA whose forwarding is explicitly disabled. Updating the next hop or removing that UDR restores the qualified standby path. This is a declared configuration repair, not health-triggered automation. |
| Internal Standard LB HA ports / Floating IP | Engine `2026.11.17.3` qualifies the explicit single-LB/single-NIC floating HA-ports UDR steering slice in `tests/fixtures/ha-ports.ts`; see `PLATFORM.md`. It preserves original ownership/tuples and checks return routing independently. Nonfloating, undeclared/import-only, direct frontend-destination and richer layouts stay unassessed. Ordinary LB DNAT is not a substitute. |
| BGP next hop independent of speaker | Current NVA advertisements use that NVA's private IP. Advertising an LB frontend or another NVA/firewall needs an explicit owned next hop before grading; Azure support does not imply simulator support. |
| Controller-driven address reassignment | Requires explicit address-owner transitions and resulting routing. It is not LB Floating IP and is not qualified by editing a label or retaining unknown JSON. |
| ECMP hashing, live probes, timers, VMSS orchestration, state replication and session continuity | Not established by these snapshots; retain explicit conceptual-only limits. A selected modeled path does not prove Azure per-flow symmetry. |

Candidate experience: inspect the workload's exact branch-prefix route and the
ARS candidates; compare branch-side return selection; observe a declared
withdrawal; repair stale advertisement or manual steering without changing
the local witness. A later graded mission still needs native ARS/NVA/overlay
guidance, reviewed EN/JA questions and an explicit award-compatibility decision.
Navigation assistance must not reveal the repair.

### Candidate inspection and questions (not learner-published)

EN inspection: In the workload's effective routes, find `172.31.80.0/24`
and record its source and next hop. Compare the two ARS candidates and the
branch-side return path. After the declared withdrawal, repeat both traces
and check that the operations subnet remains reachable.

JA inspection: ワークロードの有効なルートで `172.31.80.0/24` を探し、
ルートのソースとネクストホップを記録します。ARS の 2 つの候補と、
ブランチ側の戻り経路を比較します。明示的な撤回後に往復のトレースを
再実行し、運用サブネットへの到達性も確認します。

EN diagnosis: The preferred overlay is down, its advertisement remains,
and the standby is available. Why can the workload-to-branch trace fail
while the branch-prefix route is still present?

| Choice | EN | JA |
| --- | --- | --- |
| A | The preferred NVA still advertises the branch prefix; the selected route outlives that NVA's usable overlay. | 優先 NVA がブランチのプレフィックスを広告し続けており、選択されたルートがその NVA の使用可能なオーバーレイより長く残っています。 |
| B | The standby NVA advertises a longer AS path; ARS cannot retain that advertisement as an alternate candidate. | 待機 NVA が長い AS パスを広告しているため、ARS はその広告を代替候補として保持できません。 |
| C | The spoke uses the hub's remote gateway; branch replies therefore follow the same NVA as outbound packets. | スポークがハブのリモートゲートウェイを使用しているため、ブランチからの応答は送信パケットと同じ NVA を通ります。 |
| D | The effective table contains the branch prefix; the failure therefore lies outside modeled routing and forwarding. | 有効なルートにブランチのプレフィックスが存在するため、障害はモデル化されたルーティングと転送の範囲外にあります。 |

JA diagnosis: 優先オーバーレイが停止しても、その広告は残り、待機 NVA は
利用可能です。ブランチのルートが存在するのに、ワークロードから
ブランチへのトレースが失敗するのはなぜですか。

Author key A: route selection does not establish onward forwarding. B confuses
a less-preferred candidate with an invalid route; C couples independent return
selection to the outbound path; D mistakes route presence for delivery.
JA 解説: 正解は A です。ルートの選択だけでは、その先への転送を保証
しません。B は低優先度と無効を混同し、C は往復の独立した経路選択を
同一視し、D はルートの存在を配信の成功と同一視しています。

EN design tradeoff: What obligation remains when manual UDR next-hop changes
are used as the HA mechanism?

| Choice | EN | JA |
| --- | --- | --- |
| A | Provide detection and a process that updates affected route tables, and verify return routing separately from the changed next hop. | 検出と対象ルートテーブルを更新する手順を用意し、変更したネクストホップとは別に戻り経路を検証します。 |
| B | Provide detection and a process that changes ARS path preference, and rely on that preference to replace the configured UDR next hop. | 検出と ARS の経路優先順位を変更する手順を用意し、その優先順位によって設定済み UDR のネクストホップを置き換えます。 |
| C | Provide detection and a process that changes the branch AS path, and use that path to establish symmetry through the new UDR next hop. | 検出とブランチの AS パスを変更する手順を用意し、そのパスによって新しい UDR ネクストホップを通る往復の対称性を確立します。 |
| D | Provide detection and a process that changes peering gateway transit, and use that setting to replace the configured UDR next hop. | 検出とピアリングのゲートウェイトランジットを変更する手順を用意し、その設定によって設定済み UDR のネクストホップを置き換えます。 |

JA design tradeoff: 手動の UDR ネクストホップ変更を HA の仕組みとして
使う場合、設計側にどのような責務が残りますか。

Author key A: this fixture declares snapshots rather than implementing detection
or updates. B and D do not rewrite an explicit UDR next hop; C does not establish
independent return-path symmetry. JA 解説: 正解は A です。このフィクスチャは
状態を宣言するもので、検出や更新処理は実装しません。B と D は明示的な
UDR のネクストホップを書き換えず、C は独立した戻り経路の対称性を
保証しません。Both drafts still require independent answer-blind EN/JA review.

Sources checked for this qualification:
[ARS route injection and primary/standby AS paths](https://learn.microsoft.com/azure/route-server/route-injection-in-spokes),
[independent next-hop support](https://learn.microsoft.com/azure/route-server/next-hop-ip),
and [HA ports configuration/symmetry boundaries](https://learn.microsoft.com/azure/load-balancer/load-balancer-ha-ports-overview).
These document-derived tests are not live-Azure qualification, answer-blind SME
review or evidence of learning effectiveness.

### Bounded HA-ports learner mission (#222, forwarding #245)

The published `ha-return-path` mission uses `ha-scenario.ts`: a smaller original
workload/workload variant of the qualified `tests/fixtures/ha-ports.ts` mechanism,
without unrelated branch/ARS controls. It retains the original frontend, rule,
pool, NVA and workload identities and has its own shared-engine counterexamples.
The earlier authoring candidate below also covers branch routing; do not confuse
its branch prefix with the learner mission's `10.82.0.0/16`. Inspect the application
`work` subnet's route to `10.82.0.0/16`: the user route keeps the next hop
`10.80.3.10`, owned by `transit-lb` / `transit-vip`. A packet probe between the
original client/server workloads retains the destination `10.82.1.10` and TCP
ports 49152/443 while showing the selected original `primary-vm` identity.
The VIP's owning subnet is context, not an extra subnet route lookup.
EN: "Inspect the transit VIP route, then compare the packet's destination and
selected NVA." JA: "中継 VIP へのルートを確認し、パケットの宛先と選択された NVA を比較してください。"
Route inspection uses existing exact-scope guidance. Scoped packet guidance and
mounted EN/JA control tests now cover the learner mission. Do not expose fixture
JSON to learners or substitute a menu of tools.

Seed the remote subnet's independent return UDR with next hop `10.80.2.4`.
Both legs can be routable while the packet check fails for different NVAs.
Repair that return route to the transit VIP; retain the forward VIP route and
verify both the original selected backend and the unaffected local witness.
EN: "Repair the remote subnet's return route; verify both directions."
JA: "リモート サブネットの戻りルートを修正し、往復の経路を検証してください。"
The shared tests qualify this wrong-return counterexample and the restored
single-NVA result; they do not prove stateful firewall delivery.

Draft diagnosis question (correct A): EN: "The forward leg selects the primary
NVA and the return leg traverses standby. Why can the configured check fail
despite both routes being reachable?" A: "Backend selection leaves the remote
subnet's independent return route unchanged." B: "Tuple preservation makes the
reply's source address become the frontend VIP." C: "Probe eligibility changes
the route table only after another route lookup." JA: "往路はプライマリ NVA、
復路はスタンバイ NVA を通ります。両方の経路に到達可能でも、構成チェックが失敗する理由は何ですか。"
A: "バックエンドの選択では、リモート サブネットの独立した戻りルートは変更されません。"
B: "タプルを維持すると、応答の送信元アドレスがフロントエンド VIP に変わります。"
C: "プローブの適格性によるルート テーブルの変更は、次のルート検索後に反映されます。"

Draft tradeoff question (correct C): EN: "Which additional evidence would
support TCP session continuity across an actual NVA failure?" A: "Healthy
backend probe snapshots and the floating HA-ports rule configuration."
B: "Effective forward and return routing tables from both backend snapshots."
C: "Existing-session state replication and traffic captures across the failure."
JA: "実際の NVA 障害をまたいだ TCP セッションの継続性を裏付ける追加の証拠はどれですか。"
A: "正常なバックエンドのプローブ スナップショットと Floating IP を使う HA ポート ルールの構成。"
B: "両方のバックエンドのスナップショットにおける往復の有効なルート テーブル。"
C: "既存セッションの状態複製と、障害の前後を含むトラフィック キャプチャ。"
These historical drafts are not the published quiz text. `scenario-course.ts`
contains the reviewed diagnosis and time-dependent tradeoff questions. An
independent answer-blind AI technical review identified ambiguity in the original
tradeoff stem; the revised stem explicitly confirms tuple and return evidence.
A second key-free UTF-8 AI review selected the intended unique answers and
confirmed EN/JA equivalence. Neither review is human SME/native-language or
novice learning-effectiveness evidence; those remain under #160/#219. The model
does not supply session-continuity evidence. No continuity conclusion earns credit.

The learner starter pins the remote return to the standby NVA: both legs remain
routable but the HA packet and independently ordered flow checks fail. The
canonical repair uses the transit VIP. A return pinned to the current primary
also satisfies this declared snapshot; it does not follow a later backend
selection. Direct forward bypass, unknown health, altered original addresses,
missing forwarding declarations and broken Operations cannot pass. This is
neither a universal symmetry guarantee nor proof of stateful firewall delivery.

Award decision: #245 itself added no XP; #222 now publishes the six new awards
under existing course ID `azure-routing-scenarios`, content version 2, using the
explicit beta policy above. No previous-session migration, new edition, saved
design conversion, historical award deletion or automatic HA credit is added.

## Original-edition ladder

| Belt | Required points | Points available before next belt | Objective |
| --- | ---: | ---: | --- |
| White | 0 | 100 | Address ownership, exact routes, direct peering |
| Yellow | 100 | 75 | Diagnose an equal-prefix UDR override |
| Orange | 175 | 150 | Longest-prefix diagnosis, two destination addresses |
| Green | 325 | 225 | Shared gateway/BGP transit and independent return routing |
| Blue | 550 | 325 | Virtual WAN propagation, table scope, private intent |
| Brown | 875 | 450 | Mixed diagnosis, independent faults, transfer/capstone |
| Black | 1,325 | 0 | Capstone completion and honest uncertainty |

Two pre-implementation design/self-review iterations on #184 revised the old
unimplemented 1,700-point plan. Quick first wins retain the existing 100- and
75-point chapters and every historical award identity/value. New work budgets
then grow to 150, 225, 325 and 450 points. Points never replace mastery checkpoints.
All six chapters have available assessments. A pre-publication budget audit
corrected the capstone's listed subtask arithmetic: branch repair 85, return
repair 115 and combined verification 110 bring its actual total to the reviewed
450-point budget. No previously published awards were repriced.

`exampleCourse` and `previewCourse` retain their historical source export names
and course ID. Their current content version is 4 and publication is `complete`.
The original eleven tasks still award exactly 175 points; fresh and returning
learners can reach 1,325 without repricing or repeated credit. The first 24 tasks
retain their 550 points and assessment identities. Gateway and WAN chapters
diagnose preconfigured transit/intent, not gateway/hub-configuration skills.
Shared-engine fixtures cover failed forward/return outcomes, both supported
repair styles, the wrong-prefix non-fix and checkpoint reachability. A browser
journey drives all 40 tasks through real controls and restores the normal design.
WAN checks require the modeled Firewall waypoint in both directions; delivered
but bypassing paths fail. The capstone keeps two faults independent and rechecks
both repairs together. Exact hub requirements name the Default table, not a
union of hub routes. These scenarios do not combine custom tables with intent.

Technical author review references Microsoft Learn's
[routing selection](https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview),
[gateway transit](https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-peering-gateway-transit)
and [hub routing](https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing).
This is not independent human subject-matter sign-off or evidence of learning
effectiveness. Novice evaluation remains #181/#160. Black belt records local
practice completion, not Azure certification. Publication `complete` describes
the available assessed path, not human validation or a live Azure guarantee.

## Journey qualification and known limits

The #202 curriculum head `e1f1057` passed full CI run `43989910088` before
merging as `8d4151e`: 937 unit tests, 369 Chromium browser cases, 18 production
cases, unchanged startup budgets and actual unpackaged/packaged Electron smoke.
Those are repository regression denominators, not human success or learning
rates. The focused learning fixtures exercise all belt thresholds, historical
175/550-point histories, exact scopes, independent faults, supported alternatives
and unsupported-result refusal. `runner.test.ts` and `progress-ledger.test.ts`
separately cover stale evidence, inserted/revised content and immutable awards.

#181 records qualification findings and follow-ups. #206 adds waypoint-aware
failed-check feedback; #207 restores focus to the next task/completion heading
after explicit advance, without adding Tab stops or changing ordinary canvas
focus. Native-control browser regressions cover the complete course in EN and
JA, with dark/reduced-motion and separate narrow/focus cases. These scripted
checks do not validate native-language clarity, assistive-technology usability,
contrast exceptions or educational effectiveness.

Remaining enhancements: #204 needs a new exact hub-table guidance adapter;
current advanced table checks are exact but their cue opens the source subnet.
#205 separates the scaffolded capstone from a genuinely novel diagnosis task.
Human recruitment, independent SME review and pre/post/delayed-transfer sessions
remain pending under #160; this work has no participant results. Use the existing
`docs/human-evaluation-pilot.md` protocol and its guided-first-mission task, not XP
or test counts, to evaluate learning. Concurrent loaded-canvas accessibility and
benchmark work is tracked separately in #201/#197/#198/#199.

## Add or change a lesson without changing runtime code

1. Add/copy a starter in `course-scenarios.ts` with a permanent scenario ID.
2. Add a lesson with permanent IDs, localized objective, ordered `taskOrder`,
   tasks and explicit earlier-lesson prerequisites. Add its ID to `lessonOrder`.
3. Compose tasks from existing check kinds below. Reference check/guidance IDs,
   not React state. Reuse scoped definitions when their meaning really is shared;
   duplicate a quiz definition when editing one lesson should not affect another.
4. Set positive first-completion points, assessment versions and permanent award
   IDs. Update central belt configuration/checkpoints and the planned budget if
   necessary. New thresholds must be achievable by the actual ordered content.
5. Add localized feedback for every answer, relevant hints and semantic guidance.
   Navigation help stays available at every belt and never removes points.
6. Run `npx vitest run learning` and `npm run build`.
   The content-only addition/reorder test demonstrates this extension path.

Changing a title/quiz wording, adding a supported lesson, changing order or tuning
thresholds needs only content and relevant fixture edits. A new task mechanism,
unsupported networking assertion or new UI control needs a small separately
registered primitive/adapter with tests; do not introduce a lesson-ID switch.

## Supported checks and guidance

| Check kind | Parameters / completion meaning |
| --- | --- |
| `scenario.loaded` | Explicitly admitted `scenarioId` in the current practice session, not a title comparison |
| `routes.inspected` | Exact owned `vnetId`, `subnetId`, IPv4 `prefix`; observation only, not proof of comprehension |
| `vnet.peered` | Distinct owned `vnetAId`/`vnetBId`; direct enabled peering, access in both directions, and explicit shared-engine `requirements` for its outcome |
| `requirements.satisfied` | Existing platform requirements, all assessed and satisfied for the current document revision |
| `quiz.answered` | Localized question/choices/feedback, unique choice IDs and one declared correct choice |

Guidance actions are `routes.open` (owned subnet and exact prefix, including
absence), `peering.command` (exact pair), and `route-table.configure` (owned
subnet, associated table and exact route). They reveal/select tools, never apply
the assessed configuration or answer a question. Actions need scoped refs in each
supported UI provider. An absent prefix must highlight the table/filter and
explain absence, not wait forever for a nonexistent row. Disabled/deleted targets
need explicit recovery. Current adapters target the mixed-network provider;
legacy native VWAN needs a separately registered action/check scope before use.

`validateCourse(unknown)` checks plain bounded data, strict schemas, IDs,
translations, ordering/prerequisites, exact-once references, awards, checkpoints,
attainable thresholds and scoped check/guidance compatibility. It admits native
starters and evaluates engine checks using the existing platform, accepting
`violated` starters but rejecting `not assessed` ones. It does not execute learner
actions, prove every future UI target is mounted, guarantee a solution exists,
or replace solution fixtures and subject-matter review. Every declared check and
guidance target must be used so its scenario scope is actually validated.

## Versioning, insertion and historical awards

The policy is exported as `courseCompatibilityPolicy` for downstream stages.
The runner and persistent ledger consume these stable identities.

| Change | Required action |
| --- | --- |
| Typo, translation, presentational wording or reorder | Keep task ID, assessment version and award ID; increment content version for publication |
| New starter assumptions, bindings, correct answer or grading | Increment affected tasks' `assessmentVersion`; reevaluate required mastery before further advance |
| Changed point values or belt thresholds | Change content config; retain points recorded at original award and disclose changed targets |
| New task inserted before current/completed content | Keep history; require unmet inserted prerequisites before the next uncompleted task; do not silently auto-complete it |
| Removed task/lesson | Archive its completion/award; never transfer credit to replacement IDs |
| Deliberately new credit | New award ID plus explicit migration policy; a version bump alone cannot award twice |

Completion records bind course/task identity, assessment version and
document revision. First awards derive `(courseId, awardId, pointsAtAward)`;
unique award identity is independent of task ordering and assessment version.
Historical awards never disappear or reprice when current content changes.
An older pass can remain history without satisfying a revised current checkpoint.
If historical points do not reach a newly raised threshold, show the gap honestly;
any additional credit/top-up needs an explicit migration, not synthetic completions.

Do not silently reprice tasks downward and make the new course impossible for
returning learners: a curriculum update must review both new-learner reachability
and paths for affected existing learners under the retained historical awards.
Keep legacy `aznet-simulator:practice:v1` entries unchanged as independent history;
none prove completion of new guided tasks. Status details offer a download of the
original legacy bytes rather than inventing guided credit or rewriting old data.

The guided ledger uses `network-simulator:learning-progress:v1`, envelope version
1 and award policy version 1. Its immutable first completion for each
`(courseId, awardId)` supplies the historical points; no mutable total or duplicate
award array is persisted. Reassessment records a new completion identity without
re-awarding it. Records are bounded to 2,048 completions and 1,000,000 characters.
Do not silently prune history or accept unknown fields/policy versions.

Only the origin's exclusive Web Locks practice owner may write practice or
awards. Pause does not relinquish an editable canvas. Return to the normal design,
discard practice or close the tab to release it; another tab can then resume the
latest saved canvas. Missing/rejected locks fail closed for practice, not normal
designs. Expected-raw comparisons additionally reject stale/old-client writes.

Quota-failed accepted completions stay in memory with **Session only**, backup
and retry-saving controls. Conflicted/corrupt/unavailable records do not invent
zero credit or overwrite originals. A refused completion sink cannot advance
the runner. Confirmed reset rechecks the confirmation snapshot and deletes only
the guided ledger, not the practice canvas, normal designs or legacy history.
Clearing browser-origin/Electron-profile data still removes local progress;
there is no authentication, cloud sync, encryption or verified certification.
