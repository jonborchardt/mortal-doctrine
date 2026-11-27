# 0007 — Character content isolation

**Status:** Accepted; first character arrives in M3/M4

**Decision.** Each character is its own workspace package (`characters/<id>`,
`@mortal-doctrine/character-<id>`, layer `content`) containing declarative, schema-validated
definitions and its assets. Characters depend only on public engine entry points and never on
each other; engine packages never depend on characters. The same applies to arenas.

**Context.** The roster is asymmetric, satirical and will be authored largely in parallel. A
character's work must not require edits to the engine or to other characters for ordinary
behavior.

**Alternatives.**

- All characters in one content package: simpler at first, but constant merge conflicts and no
  enforced independence.
- Characters as engine subclasses: couples content to engine internals; the opposite of
  composition over inheritance.

**Rationale.** Package boundaries plus the boundary checker make independence mechanical. When a
character needs something the engine cannot express, the gap becomes an explicit engine-contract
change instead of a private hack.

**Consequences.** The engine must offer declarative extension points for custom mechanics before
unusual characters can ship (M2/M3 design work). Game and Studio compose a roster from character
packages explicitly.
