/**
 * What a build made with the compiler's experimental
 * `experimentalChunkTranslations` option loads its translations with. Such a
 * build writes translations into small JSON files per locale next to its
 * JavaScript chunks, so a page downloads only the translations of the code it
 * loads, in its own locale. Compiled code imports this entry; it is not
 * written by hand.
 *
 * - The entry chunk and what it imports statically share one file per locale.
 *   The page's startup script (see the compiler's `startupScript.ts`)
 *   requests it while the HTML is parsed, and `initializeChunkTranslations()`
 *   waits for it.
 * - `loadChunk()` wraps each dynamic import: it requests the files the import
 *   needs while the chunks download, and runs the `import()` once the files
 *   have arrived, so a chunk's modules never run before their translations.
 *   Which files an import needs is in the entry's file, so no page downloads
 *   those lists with its JavaScript. A file's URL is its key, the locale and
 *   the locale's token, which the startup script holds, so the script can
 *   request the files of chunks the page preloads before any module runs;
 *   those requests are read here, not made again.
 * - The translations of the files a load needs are added to gt-react's
 *   translations cache, in one call, when the load's import runs, where `<T>`,
 *   `t` and every other API look them up by hash. Files that arrive before the
 *   cache has loaded the locale are given to that load instead, and the cache
 *   keeps the locale for good: the files a build wrote do not change.
 *
 * Which messages a file holds is the compiler's choice: this entry only loads
 * files by the keys it is given.
 *
 * A file that fails to load, or takes longer than the timeout, is reported
 * with a warning and its messages render their source.
 *
 * Nothing here runs when a module loads, and all state is on one global
 * object, which the startup script creates before any module runs.
 */
import { createDiagnosticMessage } from 'generaltranslation/diagnostics';
import {
  getI18nConfig,
  getReactI18nCache,
  getReadonlyConditionStore,
} from '@generaltranslation/react-core/pure';
import type { Content } from '@generaltranslation/format';

type Translations = Record<string, Content>;

/** The entry's file for a locale. */
type EntryFile = {
  /** The translations of the entry chunk and its static imports, by hash */
  t?: Translations;
  /** The files each dynamic import needs */
  i?: ImportedFiles;
};

/**
 * The files each dynamic import needs, as the compiler's
 * `renderImportedFiles()` writes them.
 */
type ImportedFiles = {
  /** The keys of those files and of the imported chunks */
  k: string[];
  /**
   * For the chunk whose key is at the same place in `k`: whether its import
   * needs the file of that key, then the other files it needs, as places in
   * `k` in pairs of the first and how many follow on from it.
   */
  c: (number[] | 0 | undefined)[];
};

/** Vite's preload call, which adds links for `deps` and then calls `load`. */
type PreloadChunk<T> = (
  load: () => Promise<T>,
  deps: string[] | undefined,
  url: string | undefined
) => Promise<T>;

/**
 * What the page's startup script leaves on `globalThis` for this entry, with
 * what this entry keeps there. The compiler writes the first seven.
 * @internal
 */
export type ChunkTranslationsState = {
  /** The URL the build's files are served from */
  b?: string;
  /** The key of the entry's file: the entry chunk's file without its extension */
  f?: string;
  /** The hash in the name of the entry's file, by locale */
  h?: Record<string, string>;
  /**
   * The token in the name of every other file of a locale, by locale. In a
   * build that names each file by its own hash, the token in the name of the
   * locale's map of those hashes.
   */
  v?: Record<string, string>;
  /** The key of the maps, in a build that has them */
  k?: string;
  /** The maps the startup script requested, by locale */
  m?: Record<string, Promise<unknown> | undefined>;
  /** The hash in the name of each file, from the maps that have arrived, by locale and key */
  c?: Record<string, Record<string, string>>;
  /** The locale the startup script read */
  l?: string;
  /** The entry's files the startup script requested, by locale */
  p?: Record<string, Promise<unknown> | undefined>;
  /**
   * The files of preloaded chunks the startup script requested, by locale
   * and key
   */
  g?: Record<string, Promise<unknown> | undefined>;
  /** Milliseconds to wait for a file */
  w?: number;
  /**
   * The translations that have arrived and are not in the translations cache
   * yet, by locale and hash
   */
  t?: Record<string, Translations>;
  /** Whether the translations cache has loaded the locale */
  y?: boolean;
  /** The files each dynamic import needs, once an entry's file has arrived */
  i?: ImportedFiles;
  /**
   * Whether each requested file arrived in time: the entry's by locale, any
   * other by locale and key
   */
  r?: Record<string, Promise<boolean> | undefined>;
};

type InitializeConfig = {
  loadTranslations?: unknown;
  cacheExpiryTime?: number | null;
};

function getState(): ChunkTranslationsState {
  const scope = globalThis as {
    __GT_CHUNK_TRANSLATIONS__?: ChunkTranslationsState;
  };
  return (scope.__GT_CHUNK_TRANSLATIONS__ ||= {});
}

/**
 * Runs a dynamic import once the translation files it needs have arrived, so
 * no module of its chunks runs before them. The files are requested while the
 * chunks download: `preload` adds its links at once, and only the `import()`
 * waits. In a locale that renders the source this is `preload(start, deps,
 * url)`, the call the bundler wrote.
 * @param start Calls `import()`.
 * @param chunk The file of the imported chunk, or 0 when it is the first of `deps`.
 * @param preload Vite's preload call for the import, with its arguments after it.
 * @internal
 */
export function loadChunk<T>(
  start: () => Promise<T>,
  chunk: string | 0,
  preload?: PreloadChunk<T>,
  deps?: string[],
  url?: string
): Promise<T> {
  return gateChunk(requestFile, start, chunk, preload, deps, url);
}

function gateChunk<T>(
  request: typeof requestFile,
  start: () => Promise<T>,
  named: string | 0,
  preload: PreloadChunk<T> | undefined,
  deps: string[] | undefined,
  url: string | undefined
): Promise<T> {
  const run = (load: () => Promise<T>) =>
    preload ? preload(load, deps, url) : load();
  const chunk = named || (deps && deps[0]);
  const locale = chunk ? getTranslatedLocale() : undefined;
  if (!chunk || locale === undefined) return run(start);
  const state = getState();
  const requestFiles = () =>
    Promise.all(
      listImportedFiles(state.i, chunk).map((file) =>
        request(state, locale, file)
      )
    );
  // Which files the import needs is known once the entry's file has arrived
  const translations = state.i
    ? requestFiles()
    : requestEntry(state, locale).then(requestFiles);
  // The bundler preloads the chunk when it lists it
  if (named || !preload) preloadChunk(state, chunk);
  return run(() =>
    translations.then(() => {
      addArrived(state);
      return start();
    })
  );
}

function listImportedFiles(
  imported: ImportedFiles | undefined,
  chunk: string
): string[] {
  if (!imported) return [];
  const place = imported.k.indexOf(chunk.replace(/\.[cm]?js$/, ''));
  const needed = imported.c[place] || [];
  const files = needed[0] ? [imported.k[place]] : [];
  for (let pair = 1; pair < needed.length; pair += 2) {
    for (let next = 0; next < needed[pair + 1]; next++) {
      files.push(imported.k[needed[pair] + next]);
    }
  }
  return files;
}

/**
 * Downloads a chunk without running it, as a `modulepreload` link does, so
 * the `import()` that waits for translations finds it loaded. A page that
 * preloads the chunk already keeps its own link.
 */
function preloadChunk(state: ChunkTranslationsState, chunk: string): void {
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  // Requested as the import() requests it
  link.crossOrigin = '';
  link.href = (state.b || '') + chunk;
  const links = document.getElementsByTagName('link');
  for (let index = 0; index < links.length; index++) {
    if (links[index].href === link.href) return;
  }
  document.head.appendChild(link);
}

/**
 * Requests translation files in the current locale. For an app that loads
 * chunks itself, as from preload links its server writes: call it with the
 * chunk's keys under `imports` in the build's `gt-chunk-translations.json`,
 * and wait for it before the chunk is imported. Returns undefined when the
 * locale renders the source.
 * @param files The keys of the files.
 */
export function loadChunkTranslations(
  files: readonly string[]
): Promise<void> | undefined {
  const locale = files.length ? getTranslatedLocale() : undefined;
  if (locale === undefined) return undefined;
  const state = getState();
  return Promise.all(
    files.map((file) => requestFile(state, locale, file))
  ).then(() => addArrived(state));
}

/**
 * Starts gt-react for a build with chunk translations: the locale's whole
 * catalog is not loaded, and the returned promise also waits for the entry's
 * translations.
 * @param initialize gt-react's `initializeGTSPA`.
 * @internal
 */
export function initializeChunkTranslations<C extends InitializeConfig>(
  initialize: (config: C) => Promise<void>,
  config: C
): Promise<void> {
  const state = getState();
  const initialized = initializeCache(initialize, config, state);
  const locale = getTranslatedLocale();
  return Promise.all([
    initialized,
    locale === undefined ? undefined : requestEntry(state, locale),
  ]).then(() => addArrived(state));
}

/**
 * Starts gt-react with a cache that loads the locale with what has arrived so
 * far, and keeps it for good: the files a build wrote do not change. The
 * condition store exists once `initialize` returns.
 */
function initializeCache<C extends InitializeConfig>(
  initialize: (config: C) => Promise<void>,
  config: C,
  state: ChunkTranslationsState
): Promise<void> {
  return initialize({
    ...config,
    cacheExpiryTime: null,
    loadTranslations: (locale: string) =>
      Promise.resolve(takeArrived(state, locale)),
  }).then(() => {
    state.y = true;
  });
}

/**
 * `initializeChunkTranslations()` for a build that names each file by the
 * hash of its own content (the compiler's `map` naming): also reads the
 * locale's map of those hashes when it arrives, without waiting for it.
 * @internal
 */
export function initializeMappedChunkTranslations<C extends InitializeConfig>(
  initialize: (config: C) => Promise<void>,
  config: C
): Promise<void> {
  const initialized = initializeChunkTranslations(initialize, config);
  const locale = getTranslatedLocale();
  if (locale !== undefined) void requestMap(getState(), locale);
  return initialized;
}

/**
 * `loadChunk()` for such a build: the hash in a file's name comes from the
 * map, so a file is requested once the map has arrived, and the import runs
 * once both have.
 * @internal
 */
export function loadMappedChunk<T>(
  start: () => Promise<T>,
  chunk: string | 0,
  preload?: PreloadChunk<T>,
  deps?: string[],
  url?: string
): Promise<T> {
  return gateChunk(requestMappedFile, start, chunk, preload, deps, url);
}

/** `loadChunkTranslations()` for such a build. */
export function loadMappedChunkTranslations(
  files: readonly string[]
): Promise<void> | undefined {
  const locale = files.length ? getTranslatedLocale() : undefined;
  if (locale === undefined) return undefined;
  const state = getState();
  return Promise.all(
    files.map((file) => requestMappedFile(state, locale, file))
  ).then(() => addArrived(state));
}

function requestMappedFile(
  state: ChunkTranslationsState,
  locale: string,
  file: string
): Promise<boolean> {
  const hashes = state.c?.[locale];
  if (!hashes) {
    return requestMap(state, locale).then((loaded) =>
      loaded && state.c?.[locale]
        ? requestMappedFile(state, locale, file)
        : false
    );
  }
  const hash = hashes[file];
  // The map lists the files that exist
  if (hash === undefined) return Promise.resolve(true);
  const key = `${locale} ${file}`;
  const requested = state.g?.[key];
  if (requested) state.g![key] = undefined;
  return request(
    state,
    key,
    getFileUrl(state, file, locale, hash),
    requested,
    (translations: Translations) => register(state, locale, translations)
  );
}

function requestMap(
  state: ChunkTranslationsState,
  locale: string
): Promise<boolean> {
  const token = state.v?.[locale];
  if (state.k === undefined || token === undefined) {
    // Kept, so the page is warned once, for the entry's file or for this
    return ((state.r ||= {})[locale] ||= warnMissingLocale(state, locale));
  }
  const requested = state.m?.[locale];
  if (requested) state.m![locale] = undefined;
  return request(
    state,
    `map ${locale}`,
    getFileUrl(state, state.k, locale, token),
    requested,
    (hashes: Record<string, string>) => {
      (state.c ||= {})[locale] = hashes;
    }
  );
}

/** The locale to load translations for, or undefined when the source renders. */
function getTranslatedLocale(): string | undefined {
  let locale: string;
  try {
    const store = getReadonlyConditionStore();
    if (!store.getEnableI18n()) return undefined;
    locale = store.getLocale();
  } catch {
    // A chunk imported before initializeGTSPA() has only the startup script's locale
    return getState().l;
  }
  return getI18nConfig().requiresTranslation({ locale }) ? locale : undefined;
}

function requestEntry(
  state: ChunkTranslationsState,
  locale: string
): Promise<boolean> {
  const hash = state.h?.[locale];
  const entry = state.f;
  if (entry === undefined || hash === undefined) {
    // Kept, so the page is warned once
    return ((state.r ||= {})[locale] ||= warnMissingLocale(state, locale));
  }
  const requested = state.p?.[locale];
  if (requested) state.p![locale] = undefined;
  return request(
    state,
    locale,
    getFileUrl(state, entry, locale, hash),
    requested,
    (file: EntryFile) => {
      register(state, locale, file.t);
      state.i = file.i;
    }
  );
}

function warnMissingLocale(
  state: ChunkTranslationsState,
  locale: string
): Promise<boolean> {
  console.warn(createMissingLocaleWarning(locale, state.v === undefined));
  return Promise.resolve(false);
}

function requestFile(
  state: ChunkTranslationsState,
  locale: string,
  file: string
): Promise<boolean> {
  const token = state.v?.[locale];
  if (token === undefined) {
    // Kept, so the page is warned once
    return ((state.r ||= {})[locale] ||= warnMissingLocale(state, locale));
  }
  const key = `${locale} ${file}`;
  const requested = state.g?.[key];
  if (requested) state.g![key] = undefined;
  return request(
    state,
    key,
    getFileUrl(state, file, locale, token),
    requested,
    (translations: Translations) => register(state, locale, translations)
  );
}

// The compiler's getFileName() writes files by the same name
function getFileUrl(
  state: ChunkTranslationsState,
  file: string,
  locale: string,
  hash: string
): string {
  return `${state.b || ''}${file}.${locale}.${hash}.json`;
}

function register(
  state: ChunkTranslationsState,
  locale: string,
  translations: Translations | undefined
): void {
  Object.assign(((state.t ||= {})[locale] ||= {}), translations);
}

/**
 * Adds the files that have arrived to the translations cache, in one call:
 * each call copies the locale's whole table. A load of the locale that is
 * still running would replace what is added before it resolves, so until it
 * has, they wait for it to take them.
 */
function addArrived(state: ChunkTranslationsState): void {
  if (!state.y || !state.t) return;
  const arrived = state.t;
  state.t = undefined;
  getReactI18nCache().updateTranslations(arrived);
}

/** What has arrived for a locale, which its load takes. */
function takeArrived(
  state: ChunkTranslationsState,
  locale: string
): Translations {
  const arrived = state.t?.[locale] || {};
  if (state.t) delete state.t[locale];
  return arrived;
}

/**
 * Requests a file once, and resolves to whether it arrived in time.
 *
 * - A file that fails is requested again by the next import that needs it.
 * - A file that is late is not waited for again: what needs it renders the
 *   source until it arrives, and it is still read when it does.
 *
 * @param requested The request, when the startup script made it already.
 */
function request<F extends object>(
  state: ChunkTranslationsState,
  key: string,
  url: string,
  requested: Promise<unknown> | undefined,
  read: (file: F) => void
): Promise<boolean> {
  const requests = (state.r ||= {});
  return (requests[key] ||= new Promise((resolve) => {
    const timeout = getTimeout(state);
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      console.warn(createTimeoutWarning(url, timeout));
      requests[key] = Promise.resolve(false);
      resolve(false);
    }, timeout);
    const fail = (details: string) => {
      clearTimeout(timer);
      console.warn(createFailedWarning(url, details));
      requests[key] = undefined;
      resolve(false);
    };
    (requested || fetchJson(url)).then(
      (file) => {
        if (!file || typeof file !== 'object') {
          fail('The file is not a JSON object');
          return;
        }
        clearTimeout(timer);
        read(file as F);
        // A late file is read when it arrives, as nothing waits for it
        if (late) addArrived(state);
        requests[key] = Promise.resolve(true);
        resolve(true);
      },
      (error: unknown) => fail(String(error))
    );
  }));
}

function fetchJson(url: string): Promise<unknown> {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

function getTimeout(state: ChunkTranslationsState): number {
  return state.w ?? 10_000;
}

function createTimeoutWarning(url: string, timeout: number): string {
  return createDiagnosticMessage({
    source: 'gt-react',
    severity: 'Warning',
    whatHappened: `The translations in ${url} did not load within ${timeout} ms`,
    reassurance: 'Their messages render the source text until they arrive',
  });
}

function createFailedWarning(url: string, details: string): string {
  return createDiagnosticMessage({
    source: 'gt-react',
    severity: 'Warning',
    whatHappened: `Could not load the translations in ${url}`,
    reassurance: 'Their messages render the source text',
    fix: 'Deploy the .json files the build wrote next to its chunks',
    details,
  });
}

function createMissingLocaleWarning(
  locale: string,
  noStartupScript: boolean
): string {
  return createDiagnosticMessage({
    source: 'gt-react',
    severity: 'Warning',
    whatHappened: noStartupScript
      ? 'This build loads translations per chunk, but the page did not run its startup script'
      : `This build has no translations for "${locale}"`,
    reassurance: 'Messages render the source text',
    fix: noStartupScript
      ? 'Serve the index.html the build wrote, or add the startupScript from gt-chunk-translations.json to the page before its module scripts'
      : `Add the "${locale}" translations file at files.gt.output and build again`,
  });
}
