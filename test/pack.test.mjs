/**
 * This pack publishes what it promises.
 *
 * These checks belong to the pack, not to the platform that installs it. A platform test that reads
 * this repository would fail on a machine where it was never checked out, and it would be measuring
 * somebody else's content rather than its own behaviour — so the rules about *these* packages live
 * here, beside them, and run with nothing but Node.
 *
 *   node --test test/
 *
 * Each one exists because it has gone wrong at least once: a file on disk that was never pushed, an
 * entry document loading a script that was not published, a locale declared with no strings behind
 * it, and a version that agreed with the index but not with the package.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PACK = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every name a package may keep its manifest under, best first. */
const MANIFESTS = ["index.json", "app.json", "game.json", "course.json", "theme.json"];

const manifest = JSON.parse(readFileSync(join(PACK, "coach.json"), "utf8"));

/**
 * One entry per package-version, whichever shape the file is in.
 *
 * A package is written once with its versions inside it — the identity said once, and the digest,
 * size and location of each release with that release. These checks are each about one set of files,
 * so they read the flat form.
 */
const packages = (manifest.packages ?? []).flatMap((pkg) => {
  const map = pkg.versions ?? (typeof pkg.version === "object" ? pkg.version : null);
  if (!map) return [pkg];
  return Object.entries(map).map(([version, own]) => ({
    ...pkg,
    ...own,
    version,
    ref: own.ref ?? pkg.ref,
    path: own.path ?? pkg.path,
  }));
});
const apps = packages.filter((pkg) => (pkg.type ?? pkg.kind) === "app");

/** Newest first, and `0.10.0` after `0.9.0` rather than before it, which is what text sorting says. */
const compare = (a, b) => {
  const parse = (value) => value.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === y) continue;
    if (x === undefined) return typeof y === "string" ? -1 : 1;
    if (y === undefined) return typeof x === "string" ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return y - x;
    return typeof x === "number" ? -1 : typeof y === "number" ? 1 : String(x) < String(y) ? 1 : -1;
  }
  return 0;
};

const manifestOf = (pkg) => {
  const dir = join(PACK, pkg.path);
  const name = MANIFESTS.find((candidate) => existsSync(join(dir, candidate)));
  return name ? { file: join(dir, name), name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) } : null;
};

test("points every package at a folder that exists", () => {
  const missing = packages.filter((pkg) => !existsSync(join(PACK, pkg.path))).map((pkg) => pkg.name);
  assert.deepEqual(missing, []);
});

test("gives every package a version and an integrity, which is what makes an install verifiable", () => {
  const incomplete = packages.filter((pkg) => !pkg.version || !pkg.integrity).map((pkg) => pkg.name);
  assert.deepEqual(incomplete, []);
});

test("gives every package a cover, because a catalogue of grey placeholders looks abandoned", () => {
  const bare = packages
    .filter((pkg) => (pkg.type ?? pkg.kind) !== "asset")
    .filter((pkg) => {
      const own = manifestOf(pkg);
      const image = own?.data.image;
      if (!image) return true;
      // A quiz keeps its pictures in `rsc/`, an app beside its manifest. Both are resolved, because
      // the point of the check is that the cover exists, not where the author decided to put it.
      return ![image, join("rsc", image)].some((where) => existsSync(join(PACK, pkg.path, where)));
    })
    .map((pkg) => pkg.name);
  assert.deepEqual(bare, []);
});

test("has a manifest of its own", () => {
  const without = packages.filter((pkg) => !manifestOf(pkg)).map((pkg) => pkg.name);
  assert.deepEqual(without, []);
});

/**
 * The index and the package agreeing on which version this *is*.
 *
 * Only the newest: a working tree holds one version of a package, and the older entries in the index
 * describe files that live somewhere else — on a release branch, or in a folder of their own. Asking
 * them to match the manifest in front of us would be asking the tree to be three versions at once.
 */
test("says the same version in the index and in the package", () => {
  const newest = new Map();
  for (const pkg of packages) {
    const seen = newest.get(pkg.name);
    if (!seen || compare(pkg.version, seen.version) < 0) newest.set(pkg.name, pkg);
  }

  const disagreeing = [];
  for (const pkg of newest.values()) {
    const own = manifestOf(pkg);
    if (!own) continue;
    if (own.data.version !== pkg.version) {
      disagreeing.push(`${pkg.name}: index ${pkg.version}, package ${own.data.version ?? "none"}`);
    }
  }
  assert.deepEqual(disagreeing, []);
});

test("points `entry` at a document that is really there", () => {
  const broken = [];
  for (const pkg of apps) {
    const own = manifestOf(pkg);
    const entry = own?.data.entry;
    if (!entry) continue; // a declarative mechanic has no document of its own
    if (!existsSync(join(PACK, pkg.path, entry))) broken.push(`${pkg.name}: ${entry}`);
  }
  assert.deepEqual(broken, []);
});

/**
 * The failure that started all of this.
 *
 * A game worked on the machine it was written on and showed a black screen everywhere else, because
 * the script its page loads was on disk and had never been published. The page says what it needs;
 * this checks that every local thing it names was shipped.
 */
test("publishes every local file its entry document loads", () => {
  const missing = [];

  for (const pkg of apps) {
    const own = manifestOf(pkg);
    const entry = own?.data.entry;
    if (!entry) continue;

    const entryPath = join(PACK, pkg.path, entry);
    if (!existsSync(entryPath)) continue;

    const html = readFileSync(entryPath, "utf8");
    const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);

    for (const ref of referenced) {
      // Anything absolute is the platform's — the kit, the SDK — and not this pack's to publish.
      if (/^(https?:|data:|\/|#)/.test(ref)) continue;
      const target = join(dirname(entryPath), ref.split("?")[0]);
      if (!existsSync(target)) missing.push(`${pkg.name}: ${ref}`);
    }
  }

  assert.deepEqual(missing, []);
});

test("ships nothing the installer would discard, so what is published is what runs", () => {
  // The allowlist for an app: markup, script, styles, pictures, sound, fonts. Anything else is
  // dropped at install and the author never finds out until it is missing.
  const allowed = new Set([
    ".html", ".js", ".mjs", ".wasm", ".css", ".json", ".md", ".txt",
    ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp3", ".mp4", ".webm", ".ogg", ".wav", ".woff", ".woff2", ".pdf",
  ]);

  const discarded = [];
  const walk = (dir, label) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, label);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
      if (!allowed.has(extension)) discarded.push(`${label}: ${entry.name}`);
    }
  };

  for (const pkg of apps) walk(join(PACK, pkg.path), pkg.name);
  assert.deepEqual(discarded, []);
});

/**
 * A language somebody can pick and then cannot read.
 *
 * `locales` is what the platform lists and filters on, so declaring one is a promise that the package
 * speaks it. The two drift apart quietly: the manifest says three languages, two files were written,
 * and the third renders as raw keys for whoever chose it. The author, who reads the language they
 * wrote, never sees it.
 */
test("has a language file for every locale it declares, with the same keys in each", () => {
  const missing = [];
  const untranslated = [];

  for (const pkg of apps) {
    const own = manifestOf(pkg);
    // Only an app with a front of its own: a declarative mechanic is drawn by the platform's
    // interface, already translated, so its words are the content's rather than a bundle's.
    if (!own?.data.entry) continue;

    const declared = own.data.locales;
    if (!declared || declared.length < 2) continue;

    const bundles = new Map();
    for (const locale of declared) {
      const file = join(PACK, pkg.path, "lang", `${locale}.json`);
      if (!existsSync(file)) {
        missing.push(`${pkg.name}: lang/${locale}.json`);
        continue;
      }
      bundles.set(locale, JSON.parse(readFileSync(file, "utf8")));
    }

    const keys = new Set([...bundles.values()].flatMap((bundle) => Object.keys(bundle)));
    for (const [locale, bundle] of bundles) {
      for (const key of keys) if (!(key in bundle)) untranslated.push(`${pkg.name} ${locale}: ${key}`);
    }
  }

  assert.deepEqual(missing, []);
  assert.deepEqual(untranslated, []);
});

/*
  Digests are not checked here on purpose.

  Whether the recorded integrity matches the bytes is a real and important promise, but verifying it
  means implementing the normative algorithm — the ordering, the line-ending rule, what is excluded —
  and a second implementation of a normative algorithm is two implementations that will disagree. The
  one that counts lives with the platform, and the authoring tool answers the question directly:

      npx tsx shared/tools/coach-pack.ts <packDir> --check

  which reports any package whose files have drifted from what the catalogue records, and exits
  non-zero. That belongs in the publishing step, not in a suite that runs with nothing but Node.
*/
