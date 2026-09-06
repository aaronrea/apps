# Migration plan: GKE Autopilot + Flux + private-only access

## Why

Today, "background jobs" for this repo are GitHub Actions cron workflows that
scrape a source, write a JSON file, and `git commit` + `git push` it back to
`main` so the static site has something to `fetch()` (`.github/workflows/gas-prices.yml`,
`.github/workflows/hurricane-tracker.yml`). It works, but:

- Git is being used as a database. Every price/storm update is a commit on
  `main`, forever, with retry/rebase loops to survive push races.
- There's no real authorization model — anything that needs to run
  server-side has to be squeezed into a public GitHub Actions runner with
  `contents: write`, or skipped.
- No path to anything stateful, long-running, or with real compute needs
  (a YouTube app talking to the YouTube Data API on your behalf, a microVM
  agent sandbox, etc.).

This doc lays out moving to a small GKE Autopilot cluster for everything that
isn't "serve static files," with GitOps via Flux, identity via Google OAuth
scoped to your own Google account, and no publicly reachable surface unless
we deliberately choose one.

## What stays the same

- **The static apps stay static, and stay on GitHub Pages.** `index.html`,
  `signal-radio/`, `gas-prices/`, `hurricane-tracker/`, `sports-schedule/`
  keep being plain HTML/CSS/JS served from `aaronrea.github.io/apps/`. There
  is no reason to put a CDN-friendly static site behind a private cluster —
  it would only make it slower and add a bill. GKE is for the parts that
  need to *run code on a schedule or hold state*, not for hosting HTML.
- **The apps keep reading JSON files over plain HTTPS `fetch()`.** Only the
  place those files are produced and stored changes (see below).

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

## Authorization model

Two complementary mechanisms, use one or both depending on the workload:

1. **Tailscale-only ingress** for anything you only ever access yourself
   from your own devices (the microVM agent dashboard, ad-hoc debugging
   tools). Use the [Tailscale Kubernetes operator](https://tailscale.com/kb/1236/kubernetes-operator)
   to expose a `Service` as a tailnet-only endpoint (`tailscale.com/expose:
   "true"` annotation, or an `ingressClassName: tailscale` `Ingress`). No
   public IP is ever allocated. This is the strongest option — there's no
   internet-facing listener to attack at all.
2. **Google OAuth via Identity-Aware Proxy (IAP)** for anything you might
   eventually want to open to a second identity (e.g. your Gmail is the
   only entry in the allow-list today, but a YouTube app might later want a
   second account) or that needs a normal HTTPS URL. IAP sits in front of
   the GKE Ingress/Gateway, checks the Google OAuth identity, and only
   forwards the request if that identity is on an explicit allow-list
   (`aaron.m.rea@gmail.com`, nobody else). The workload itself never sees
   unauthenticated traffic.

**Recommendation:** default every workload to Tailscale-only. Add IAP +
public DNS only for something that specifically needs a shareable URL
(unlikely for personal tools). Never expose a bare `LoadBalancer` Service or
an `Ingress` with no auth in front of it — that's the "generalized access"
this migration exists to avoid.

## GitOps with Flux

- Cluster runs `flux bootstrap github` against this repo (or a dedicated
  `aaronrea/apps-infra` repo, see open decision below), watching a
  `gitops/` (or `clusters/autopilot/`) path.
- Each workload gets a `Kustomization` + plain manifests: `CronJob`,
  `Deployment`, `Service`, `Secret` references. No Helm needed at this
  scale — Kustomize overlays are enough for a single-cluster, single-tenant
  setup.
- Flow to change something: edit YAML → commit → push → Flux reconciles
  (default interval, e.g. 1m) → done. This replaces "edit workflow YAML,
  merge to main, GH Actions picks it up" with the same mental model, just
  pointed at a cluster instead of a runner.
- Secrets (API keys for the YouTube Data API, etc.) go through **Google
  Secret Manager + External Secrets Operator**, not plaintext in the Flux
  repo and not SOPS-encrypted blobs to manage by hand — Secret Manager is
  already IAM-scoped to your project and Workload Identity gives pods
  access without a downloaded service-account key sitting anywhere.

## GKE Autopilot fit and its one real limitation

Autopilot is the right call for the CronJobs, the YouTube app, and anything
that's a normal container: no node management, scales to ~zero cost when
idle, Google manages security patching, and it enforces sane pod security
defaults by default (which lines up with "no generalized access").

**The microVM agent architecture will not run on Autopilot.** Autopilot
does not allow privileged containers, `hostPath`/`/dev/kvm` access, or
custom kernel modules — all of which Firecracker/microVM-based sandboxing
needs to create and manage guest VMs. This isn't a quota or config issue,
it's a hard platform restriction (it's the same sandboxing Autopilot itself
relies on internally). Two ways to handle it:

- **Recommended:** run the microVM testbed on a small standalone Compute
  Engine VM (nested virtualization enabled) outside the cluster, and only
  have that VM report status to / take jobs from a service running in the
  Autopilot cluster (over the tailnet). Keeps Autopilot's guarantees intact
  for everything else and isolates the one workload that genuinely needs
  raw virtualization access.
- **Alternative:** stand up a second, regular (non-Autopilot) GKE Standard
  cluster or node pool with nested virtualization for just this workload.
  More to manage, more cost, only worth it if the microVM work needs
  Kubernetes scheduling/orchestration around it rather than just a box to
  run on.

This plan assumes the standalone-VM approach unless you'd rather manage a
second cluster.

## Migration phases

1. **Foundation** — create the GCP project (or reuse one), enable GKE
   Autopilot, stand up the cluster with private nodes and no default
   public ingress. Bootstrap Flux against a `gitops/` path. Install the
   Tailscale operator and join the cluster to your tailnet. This phase has
   no user-visible change yet.
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
without blocking each other.

## Open decisions (need your call)

- **Repo layout:** Flux manifests live in this repo under `gitops/`, or in a
  separate `aaronrea/apps-infra` repo? Keeping it in this repo is simpler
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

Happy to start on Phase 1 once the GCP project and repo-layout questions
above are settled — everything else in this doc doesn't block writing the
Terraform/Flux bootstrap manifests.
