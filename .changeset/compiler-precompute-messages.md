---
'@generaltranslation/compiler': minor
---

Build the message of each static `t` template from an `/unstable` entry at compile time. The template becomes a call that passes its message, with its hash, message tree and literal options, so the call site builds no tree when it renders. A message with values is declared once at module scope, in a function that creates it when it is first read, so a call that runs before its module's body has run, as through an import cycle, works as the template did: `` t`Hello, ${{ name }}!` `` compiles to `t(_gt(), { name })`. A message that is text is written at its call: `` t`Save` `` compiles to `t({ $_hash, $_tree: 'Save' })`. This covers `t`, `useGT()` and `getGT()` templates with named or plain values and static `plural`, `selectordinal`, `select`, `part`, `n`, `number`, `date` and `time` helpers. `msg` templates, `derive()` and other non-static templates keep the tagged template, as before. Hashes do not change.

These calls need runtime packages (`gt-react`, `gt-next`, `gt-i18n` and the others with an `/unstable` entry) that read them. When the compiler finds an older one installed, it warns and keeps the tagged templates; the new `precomputeMessages` plugin option sets it either way.

A build with `experimentalChunkTranslations` splits the translations of these calls by chunk, or by module with `experimentalChunkTranslationsSplit: 'module'`, as it splits those of tagged templates.
