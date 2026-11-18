import { TraverseOptions } from '@babel/traverse';
import * as t from '@babel/types';
import { isUnstableGTImportSource } from 'generaltranslation/internal';
import { TransformState } from '../state/types';
import { injectUnstableTaggedTemplateHash } from '../transform/injection/injectUnstableTaggedTemplateHash';
import {
  keepUnsplit,
  recordChunkHash,
} from '../transform/chunk-translations/chunkTranslationsModule';

/**
 * Unstable hash injection pass — injects `$_hash` into statically analyzable
 * unstable tagged templates (t`...`). Each template is hashed and rewritten
 * in the same visit, so this pass needs no collection counters.
 */
export function unstableHashInjectionPass(
  state: TransformState
): TraverseOptions {
  // A build with chunk translations splits t templates by chunk; m() renders
  // a msg away from its call site, so its translation stays unsplit
  const onHash = state.settings.chunkTranslations
    ? (hash: string, isMsg: boolean) =>
        isMsg ? keepUnsplit(hash, state) : recordChunkHash(hash, state)
    : undefined;
  return {
    TaggedTemplateExpression(path) {
      if (injectUnstableTaggedTemplateHash(path, onHash)) {
        state.statistics.unstableHashInjectionsCount += 1;
      }
    },
  };
}

/** Whether a file imports an unstable source, so the pass can be skipped. */
export function importsUnstableSource(ast: t.File): boolean {
  return ast.program.body.some(
    (statement) =>
      t.isImportDeclaration(statement) &&
      isUnstableGTImportSource(statement.source.value)
  );
}
