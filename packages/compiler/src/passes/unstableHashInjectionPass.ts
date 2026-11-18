import generate from '@babel/generator';
import { TraverseOptions } from '@babel/traverse';
import * as t from '@babel/types';
import { isUnstableGTImportSource } from 'generaltranslation/internal';
import { TransformState } from '../state/types';
import { injectUnstableTaggedTemplateHash } from '../transform/injection/injectUnstableTaggedTemplateHash';
import type { HoistMessage } from '../transform/injection/precomputeUnstableMessage';
import {
  keepUnsplit,
  recordChunkHash,
} from '../transform/chunk-translations/chunkTranslationsModule';

// Name of the module-scope functions that hold precomputed messages
const MESSAGE_NAME = 'gt';
// Property of such a function that keeps its message
const MESSAGE_PROPERTY = 'm';

/**
 * Unstable hash injection pass — injects `$_hash` into statically analyzable
 * unstable tagged templates (t`...`). Each template is hashed and rewritten
 * in the same visit, so this pass needs no collection counters.
 *
 * With `precomputeMessages`, a static t template is replaced by a call with
 * its precomputed message. A message with values is declared once at module
 * scope, in a function that creates it when it is first read: a function
 * declaration can be called before its module's body has run, as through an
 * import cycle, where a constant could not be read yet.
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
  const declarations: t.FunctionDeclaration[] = [];
  // Call sites with the same message share one, by its code.
  const hoisted = new Map<string, t.Identifier>();
  return {
    TaggedTemplateExpression(path) {
      const hoist: HoistMessage = (message) => {
        const { code } = generate(message, { compact: true });
        let id = hoisted.get(code);
        if (!id) {
          id = path.scope
            .getProgramParent()
            .generateUidIdentifier(MESSAGE_NAME);
          hoisted.set(code, id);
          const kept = () =>
            t.memberExpression(
              t.cloneNode(id!),
              t.identifier(MESSAGE_PROPERTY)
            );
          declarations.push(
            t.functionDeclaration(
              id,
              [],
              t.blockStatement([
                t.returnStatement(
                  t.logicalExpression(
                    '||',
                    kept(),
                    t.assignmentExpression('=', kept(), message)
                  )
                ),
              ])
            )
          );
        }
        return t.callExpression(t.cloneNode(id), []);
      };
      if (
        injectUnstableTaggedTemplateHash(
          path,
          onHash,
          state.settings.precomputeMessages ? hoist : undefined
        )
      ) {
        state.statistics.unstableHashInjectionsCount += 1;
      }
    },
    Program: {
      exit(path) {
        path.node.body.push(...declarations);
      },
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
