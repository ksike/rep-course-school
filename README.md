# School content pack for Open Coach

Maths quizzes, learning games and a worked example of every kind of package Open Coach can install.
Point an Open Coach instance at this repository and everything below is available to a channel; remove
a package and nothing else changes, which is the property the whole format exists to protect.

```
https://github.com/ksike/rep-course-school
```

## What is in it

| Package | Kind | What it is |
|---|---|---|
| `maths-times-tables`, `maths-place-value`, `maths-reading-numbers`, `maths-early-algebra` | quiz | Primary maths, with open answers as well as multiple choice |
| `arcade-falling-blocks` | app · game | A complete standalone game: sessions, saved best score, ranking, sound, two languages, three difficulties |
| `science-weather-station` | app · tool | A tool rather than a game: reads a live forecast through the platform's proxy, so the API key stays on the server |
| `maths-times-tables-match`, `maths-number-line-order`, `language-spelling-gaps` | app · game | Declarative mechanics — no code of their own, drawn by the platform |

The two standalone apps are meant to be read as much as played. Between them they use every part of the
app SDK: `init` and `update`, per-person storage, rankings, a proxied network call, package language
files, the shared style kit, and leaving without the host having to guess.

## How it is laid out

```
coach.json                     the pack index: what is published, at which version, with which digest
data/quiz/<category>/<name>/   index.json + one file per language
data/game/<category>/<name>/   index.json + web/ + lang/
data/app/<category>/<name>/    the same; a game is one profile of an app
```

Every package describes itself in **`index.json`**, whatever kind it is: `type` names the kind, and an
app's `profile` says whether it is a `game` or a `tool`. One name to look for rather than four.

Language files live in `lang/<locale>.json` beside the manifest — flat keys, plain strings — and are
loaded by the SDK, so adding a language is a file rather than a change to any code.

## Publishing a change

```bash
npx tsx shared/tools/coach-pack.ts tmp/rep-course-school --bump <package>=patch|minor|major
```

That rewrites `coach.json` with the new version, size and digest. **Bump anything you change**: an
installed copy is verified against the digest the manifest declares, and content that changed without
its version changing is refused rather than silently replaced.

Releases live on version branches (`v1.0.0`), and `coach.json` names the one an instance should follow
in `repository.defaultRef`. `main` is where work happens; nobody should install from it.

## Licence

MIT, see [LICENSE](LICENSE). The quiz content is original and written for this pack.
