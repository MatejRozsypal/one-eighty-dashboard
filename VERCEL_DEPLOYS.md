# Why `vercel.json` disables git deployments

`vercel.json` carries one setting and no explanation, because Vercel's schema
rejects unknown keys — including a `//` comment field. The explanation lives
here.

## What it does

```json
"git": { "deploymentEnabled": { "venev-onboarding": false } }
```

A push to `venev-onboarding` no longer builds. `npx vercel --prod` still does,
because a CLI deploy is not a git deployment. **Shipping is a deliberate act
again**, which is what runbook 29 already claimed and what everyone believed.

## Why it exists

On 9 September 2026 a push to `venev-onboarding` produced a production
deployment sixty seconds later, aliased to dashboard.oneeighty.cz. Nobody
decided to ship it. That branch is Vercel's *production branch*, so every push
to it shipped the whole app.

`vercel --prod` had only ever *looked* like the sole route to production
because git builds were silently dying in four seconds while `rootDirectory`
was unset. Fixing that setting — correctly, for other reasons — turned an
accident into a deploy pipeline, and nothing announced the change.

## Why it is at the repository root

The project's root directory is `dashboard/`, which is where Vercel reads
**build** configuration from. The git gate is different: it is evaluated when
the webhook arrives, before any root directory is applied. Placed under
`dashboard/` it was simply never consulted — a push on 9 Sep produced a
production build with the gate supposedly in force.

## The better fix, which is not in the repo

Point Vercel's **production branch** at something nobody pushes, and let
`venev-onboarding` produce previews. Then a push is not merely blocked, it is
useful: it builds something you can look at before promoting. That is a project
setting rather than a file, so it cannot live here.

## If production looks stale after a deploy

Check whether the alias actually moved:

```bash
npx vercel alias ls | grep dashboard.oneeighty.cz
```

A **rollback pins the production alias**. After one, new production deployments
build, report `Ready` and `target: production`, and never take the domain —
they pile up invisibly. `npx vercel promote <deployment-url>` cancels the pin.
That is what made the app look frozen for several hours on 9 Sep while three
deployments sat unused.
