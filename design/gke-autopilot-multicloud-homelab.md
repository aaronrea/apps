# Design: GKE Autopilot homelab, single-cloud foundation → multi-cloud DR

This assimilates two prior documents into one:

- the original migration plan for moving this repo's background jobs off
  GitHub Actions and onto a private GKE Autopilot cluster, and
- the ["Multi-Cloud K8s Homelab: GKE ↔ EKS over AWS Interconnect"](https://gist.github.com/aaronrea/5794c7667b58e7fc78910abffaca49f1)
  gist, a separate, more ambitious exercise in cross-cloud failover and
  replication.

They are not competing plans — the gist's own sequencing starts with "GKE
Autopilot + Flux + Tailscale-only ingress, running solo — get this boring
and reliable first," which *is* the foundation plan. This doc keeps that
relationship explicit: **Part 1** is the foundation (ships first, useful on
its own), **Part 2** is the multi-cloud DR exercise built on top of it
(ships later, entirely optional, doesn't block Part 1).

No detail from either source document has been dropped; where they
overlapped (Autopilot's platform restrictions), both original workloads
that hit the restriction are called out.

---

# Part 1 — Single-cloud foundation

## Why

Today, "background jobs" for this repo are GitHub Actions cron workflows
that scrape a source, write a JSON file, and `git commit` + `git push` it
back to `main` so the static site has something to `fetch()`
(`.github/workflows/gas-prices.yml`, `.github/workflows/hurricane-tracker.yml`).
It works, but:

- Git is being used as a database. Every price/storm update is a commit on
  `main`, forever, with retry/rebase loops to survive push races.
- There's no real authorization model — anything that needs to run
  server-side has to be squeezed into a public GitHub Actions runner with
  `contents: write`, or skipped.
- No path to anything stateful, long-running, or with real compute needs
  (a YouTube app talking to the YouTube Data API on your behalf, a microVM
  agent sandbox, etc.).

This part moves that work to a small GKE Autopilot cluster, GitOps-managed
via Flux, identity via Google OAuth scoped to your own Google account, and
no publicly reachable surface unless deliberately chosen.

## What stays the same

- **The static apps stay static, and stay on GitHub Pages.** `index.html`,
  `signal-radio/`, `gas-prices/`, `hurricane-tracker/`, `sports-schedule/`
  keep being plain HTML/CSS/JS served from `aaronrea.github.io/apps/`. There
  is no reason to put a CDN-friendly static site behind a private cluster —
  it would only make it slower and add a bill. GKE is for the parts that
  need to *run code on a schedule or hold state*, not for hosting HTML.
- **The apps keep reading JSON files over plain HTTPS `fetch()`.** Only the
  place those files are produced and stored changes.

## What moves

| Today | Becomes |
|---|---|
| GH Actions cron → scrape → `git commit` to `main` | K8s `CronJob` in GKE Autopilot → scrape → write to object storage |
| `gas-prices/data/prices.json` committed to git | `prices.json` in a public-read GCS bucket (or Cloud CDN in front of it) |
| `hurricane-tracker/data/*.json` committed to git | same pattern, GCS |
| Workflow YAML hand-edited, applied by merging to `main` | Kubernetes manifests reconciled into the cluster by Flux from a `gitops/` (or separate) repo |
| No auth model beyond "who can push to `main`" | Google OAuth (Identity-Aware Proxy) restricted to your Google account for anything with a UI; no public ingress by default |

The static pages change one line each: fetch from the GCS/CDN URL instead of
a same-repo relative path. Everything else about them is untouched.

## Target architecture

```
                         ┌─────────────────────────────┐
GitHub (this repo)       │        GKE Autopilot         │
 ├─ static apps ───────► │  (private control plane,     │
 │  (GitHub Pages,       │   no public LB by default)    │
 │   unchanged)          │                               │
 │                       │  ┌─────────────────────────┐  │
 └─ gitops/ (manifests) ─┼─►│ Flux (source-controller, │  │
    Flux watches this    │  │ kustomize-controller)    │  │
    repo/path and         │  └─────────────────────────┘  │
    reconciles it into    │             │ applies          │
    the cluster           │             ▼                  │
                          │  CronJob: gas-prices-fetch      │
                          │  CronJob: hurricane-fetch       │
                          │  Deployment: youtube-app (later)│
                          │  Deployment: microVM-agent test │
                          │             │ writes            │
                          │             ▼                    │
                          │      GCS bucket (public-read      │
                          │      objects only, bucket itself  │
                          │      not open)                    │
                          └───────────────────────────────────┘
                                         ▲
                                         │ HTTPS fetch (read-only)
                                   Static apps on GitHub Pages

Ingress path (for anything with a UI/API, e.g. the YouTube app or an agent
dashboard) — private by construction:

   You (Tailscale device) ──tailnet──► Tailscale Ingress ──► Service
   Everyone else                       (nothing to hit; no public IP/DNS)

   OR / additionally, for Google-account-gated access instead of/alongside
   Tailscale:

   You ──Google OAuth──► Identity-Aware Proxy ──► Service
   Anyone without your Google identity in the allow-list ──► 403, no app
   logic ever runs
```

## Authorization and network model — zero-trust by construction

**Ingress**, two complementary mechanisms, use one or both per workload:

1. **Tailscale-only ingress** for anything you only ever access yourself
   from your own devices (the microVM agent dashboard, ad-hoc debugging
   tools). Use the [Tailscale Kubernetes operator](https://tailscale.com/kb/1236/kubernetes-operator)
   to expose a `Service` as a tailnet-only endpoint (`tailscale.com/expose:
   "true"` annotation, or an `ingressClassName: tailscale` `Ingress`). No
   public IP is ever allocated — no hostNetwork needed, so this works fine
   under Autopilot's restrictions. This is the strongest option: there's no
   internet-facing listener to attack at all.
2. **Google OAuth via Identity-Aware Proxy (IAP)** for anything that might
   eventually want a second identity added (e.g. only your Gmail is on the
   allow-list today, but a YouTube app might later want a second account) or
   that needs a normal HTTPS URL. IAP sits in front of the GKE
   Ingress/Gateway, checks the Google OAuth identity, and only forwards the
   request if that identity is on an explicit allow-list, nobody else. The
   workload itself never sees unauthenticated traffic.

**Egress**, no `0.0.0.0/0` anywhere: **PSC (Private Service Connect) /
Private Google Access / Cloud NAT** for anything the cluster needs to reach
outbound (the scrapers hitting NHC/gas-station sites, the YouTube API,
etc.). This closes the other half of "no generalized access" — an ingress
lockdown alone doesn't stop a compromised workload from exfiltrating
data outbound; egress needs its own explicit allow-list too. This applies
regardless of whether Part 2's AWS side ever gets built.

**Recommendation:** default every workload to Tailscale-only ingress + NAT
egress. Add IAP + public DNS only for something that specifically needs a
shareable URL (unlikely for personal tools). Never expose a bare
`LoadBalancer` Service, an `Ingress` with no auth in front of it, or
unrestricted `0.0.0.0/0` egress — that's the "generalized access" this
migration exists to avoid.

## GitOps with Flux

- Cluster runs `flux bootstrap github` against this repo (or a dedicated
  `aaronrea/apps-infra` repo, see open decisions), watching a `gitops/` (or
  `clusters/autopilot/`) path.
- Each workload gets a `Kustomization` + plain manifests: `CronJob`,
  `Deployment`, `Service`, `Secret` references. No Helm needed at this
  scale — Kustomize overlays are enough for a single-cluster, single-tenant
  setup (Part 1). Part 2 changes this to per-cluster overlays; see below.
- Flow to change something: edit YAML → commit → push → Flux reconciles
  (default interval, e.g. 1m) → done. This replaces "edit workflow YAML,
  merge to main, GH Actions picks it up" with the same mental model, just
  pointed at a cluster instead of a runner.
- Secrets (API keys for the YouTube Data API, etc.) go through **Google
  Secret Manager + External Secrets Operator**, not plaintext in the Flux
  repo and not SOPS-encrypted blobs to manage by hand — Secret Manager is
  already IAM-scoped to your project and Workload Identity gives pods
  access without a downloaded service-account key sitting anywhere.

## GKE Autopilot fit and its restrictions

Autopilot is the right call for the CronJobs, the YouTube app, and anything
that's a normal container: no node management, scales to ~zero cost when
idle, Google manages security patching, and it enforces sane pod security
defaults by default (which lines up with "no generalized access").

**Autopilot does not allow privileged containers, `hostNetwork`,
`hostPath`, or custom kernel modules.** This is a hard platform
restriction, not a quota or config issue — it's the same sandboxing
Autopilot itself relies on internally. Two workloads in this design hit it,
for two different reasons:

- **The microVM agent testbed** (Part 1, phase 6) needs `/dev/kvm` and
  privileged access to create and manage Firecracker/microVM guests.
- **The ZFS replication endpoint** (Part 2) needs kernel-level block device
  access to manage a ZFS pool.

Tailscale ingress needs neither `hostNetwork` nor privileged access, so it
runs fine on Autopilot proper — only these two specific workloads are
affected. For both, the fix is the same:

- **Recommended:** run the workload on a small standalone Compute Engine VM
  (nested virtualization enabled, for the microVM case) outside the
  cluster, and have it report status to / take jobs from a service running
  in the Autopilot cluster over the tailnet. Keeps Autopilot's guarantees
  intact for everything else and isolates the one or two workloads that
  genuinely need raw kernel/virtualization access.
- **Alternative:** stand up a second, regular (non-Autopilot) GKE Standard
  cluster or node pool with the needed access, if either workload needs
  Kubernetes scheduling/orchestration around it rather than just a box to
  run on. More to manage, more cost — only worth it if that scheduling is
  actually needed.

This design assumes the standalone-VM approach for both unless you'd rather
manage Standard node pools.

## Part 1 migration phases

1. **Foundation** — create the GCP project (or reuse one), enable GKE
   Autopilot, stand up the cluster with private nodes, Cloud NAT/PSC
   egress, and no default public ingress. Bootstrap Flux against a
   `gitops/` path. Install the Tailscale operator and join the cluster to
   your tailnet. This phase has no user-visible change yet.
2. **Move one background job** — pick gas-prices (simpler of the two,
   smaller blast radius) and port `fetch-prices.mjs` into a container image,
   deploy as a Flux-managed `CronJob` writing to a new GCS bucket instead of
   committing to git. Point the static `gas-prices` app at the bucket URL.
   Turn off `.github/workflows/gas-prices.yml` once it's verified stable for
   a few days.
3. **Move the second job** — same treatment for hurricane-tracker.
4. **Auth layer** — install IAP + configure the OAuth consent screen and
   allow-list (just your Gmail) so it's ready before anything actually needs
   a UI.
5. **YouTube app** — build it as a normal Autopilot `Deployment` behind
   Tailscale (and/or IAP if it ever needs a shareable link), using OAuth
   against the YouTube Data API with your own Google identity.
6. **MicroVM agent testbed** — stand up the standalone GCE VM per above,
   wire it to report into the cluster over Tailscale.

Each phase is independently shippable and reversible — nothing about phases
2–3 requires the auth/YouTube/microVM work to exist first, so they can slip
without blocking each other. Part 1 is useful and complete on its own even
if Part 2 never happens.

---

# Part 2 — Multi-cloud DR exercise (GKE ↔ EKS over AWS Interconnect)

Everything in this part is additive on top of Part 1's cluster; nothing
here is required for Part 1 to be done and useful.

## The idea

Build a practical, hands-on multi-cloud Kubernetes lab that goes beyond
"spin up two clusters." The goal is to practice real cross-cloud failover
and replication using infrastructure that was previously expensive or
fiddly to get — now free-tier and first-party on both sides.

**Core stack:**

- **GKE Autopilot** as the primary cluster (Part 1's cluster), GitOps-managed
  via Flux
- **AWS Interconnect – multicloud** (GA April 2026, free 500Mbps/region tier
  from May 2026) as the private L3 link between AWS and GCP — no VPN
  tunnels, no colo, no public internet transit
- **EKS** as the secondary/DR cluster, federated with GKE for replication
  and failover drills
- A few small apps (TBD) to actually exercise the pipe — a **ZFS
  replication endpoint** is one candidate

## Why it's worth doing

- The AWS↔GCP interconnect is genuinely new (GA'd April 2026) — this is a
  good excuse to learn it while it's still novel and free-tier
- Forces real practice with failover and replication instead of just
  standing up infra and leaving it idle
- The Tailscale-only-ingress / NAT-only-egress constraint (see Part 1) is a
  legitimate zero-trust exercise across both clouds, not just a lab toy
- Autopilot + Flux keeps day-to-day ops light so the focus stays on the
  interesting cross-cloud problems

## Zero-trust by construction, across both clouds

- All *ingress* to both clusters goes through **Tailscale only** (no public
  LoadBalancers, no public IPs) — same mechanism as Part 1, extended to EKS.
- All *egress* goes through **PSC / Private Google Access / Cloud NAT**
  (GCP, per Part 1) and the **AWS equivalents (PrivateLink / NAT Gateway)**
  — no `0.0.0.0/0` anywhere on either side.
- The private interconnect handles cluster-to-cluster traffic instead of
  public peering.

## Known gaps to solve going in

1. **GKE Autopilot restrictions** (see Part 1): no privileged containers,
   no hostNetwork, no hostPath. Tailscale ingress works fine via the
   Tailscale K8s operator (no hostNetwork needed). ZFS, however, needs
   kernel-level block access — that piece can't run on Autopilot and needs
   a small Standard GKE nodepool or a plain GCE VM instead (same pattern as
   the microVM testbed in Part 1).
2. **"Federation" needs a concrete definition before building.** The
   interconnect gives an L3 pipe, not cluster federation by itself. Two
   real options:
   - **Cilium ClusterMesh / Submariner** — live pod-to-pod service mesh
     across both clusters (harder, more interesting long-term)
   - **Flux multi-cluster** (same repo, independent reconciliation per
     cluster, one "active") — simpler, and a better match for practicing
     DR-style failover drills

   Recommendation: start with Flux multi-cluster + manual failover, add
   mesh later if desired.
3. **Free circuit ≠ free traffic.** GCP egress pricing (CDN Interconnect /
   Direct Peering / Carrier Peering) roughly doubled in North America as of
   May 1, 2026. The interconnect circuit itself is free; data transferred
   over it is not automatically free. Keep replication payloads lean.

## Suggested sequencing (Part 2, builds on Part 1 being done)

1. GKE Autopilot + Flux + Tailscale-only ingress, running solo — get this
   boring and reliable first (= Part 1, phases 1–4 minimum)
2. Stand up AWS Interconnect + EKS cluster
3. Flux fan-out to both clusters
4. Run a failover drill (manual cutover)
5. Add the ZFS replication endpoint (on non-Autopilot compute) last
6. Optional: layer in ClusterMesh/Submariner for live multi-cluster mesh

---

## Open decisions (need your call)

Foundation (Part 1):

- **Repo layout:** Flux manifests live in this repo under `gitops/`, or in
  a separate `aaronrea/apps-infra` repo? Keeping it in this repo is simpler
  (one place, one history) but mixes app code and cluster state; a separate
  repo keeps Flux's blast radius away from the static-site history. No
  strong reason to split at this scale — recommend keeping it in this repo
  unless you want infra changes to *not* trigger on every app commit (Flux
  only watches the `gitops/` path either way, so that concern is largely
  moot).
- **GCP project/billing:** which GCP project (new or existing) this runs
  under, and confirming Autopilot's baseline cost (a few CronJobs plus one
  small always-on Deployment is on the order of low tens of USD/month, not
  free like GitHub Actions + Pages currently is).
- **Domain:** IAP wants a real domain + managed TLS cert if you ever want a
  browser-friendly URL for the YouTube app; Tailscale-only workloads don't
  need one at all (tailnet DNS names are enough). Confirm whether you want
  to buy/use a domain or stay tailnet-only.

Multi-cloud DR (Part 2):

- Which apps go in first, beyond ZFS replication?
- Full multi-cluster mesh (ClusterMesh/Submariner), or DR-posture failover
  only (Flux multi-cluster + manual cutover)?
- Region pairing for the interconnect — confirm supported region combos
  before committing to cluster locations (GKE region and EKS region both
  need to support the multicloud interconnect pairing).

Happy to start on Part 1, phase 1 once the GCP project and repo-layout
questions above are settled — Part 2 doesn't block that, and can be
scoped later once Part 1 is boring and reliable.
