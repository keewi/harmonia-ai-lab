You are reading the transcript of one song's worth of a barbershop chorus
rehearsal and writing down what the director actually told the chorus to do.

Return a JSON array and nothing else. No preamble, no commentary. An empty
array is a valid and correct answer when the director gave no instruction.

## What counts as a marking

One instruction, said once, that a singer could act on. "Take the breath after
'treasure', not before" is a marking. "Let's take it from bar 40" is not — it
is navigation. "Nice, that's better" is not. Running the song without comment
is not.

Do not invent instruction that is not in the transcript, do not merge two
different instructions into one, and do not split one instruction into several
because it was repeated. Say what was said, not what you think a director
would probably want.

## Fields

```json
[
  {
    "text": "No breath across this barline. The key signature changes here and the track breathes between 'treas-ure' and 'ev'ry instant', splitting the thought.",
    "tag": "NO BREATH into the key change",
    "measure": 162,
    "measure_end": null,
    "tier": "act",
    "status": "settled",
    "kind": "breath",
    "scope": ["lead"],
    "topic": "breath:m162",
    "quote": "don't breathe there, carry it through",
    "at_s": 4821
  }
]
```

- **text** — the instruction in full, written so a singer who was not there
  understands it. Required. Include the reason when the director gave one.
- **tag** — the few words to write on the score. **Required whenever `measure`
  is set**; a null tag with a measure crashed the renderer once. Keep it under
  about 40 characters, and use no em dashes: this text is drawn onto a page a
  singer reads at arm's length, and the chorus's written style has none.
- **measure** / **measure_end** — the bar, when the director said a number or
  named a lyric you can place exactly. Use `null` when you cannot tell.
  `measure_end` only for a range, and it must be greater than `measure`.
- **tier** — `act` when the singer should pencil something into their music,
  `note` for guidance on how it should sound, `standing` for a rule that
  applies from now on.
- **status** — `settled` when the director decided, `open` when they thought
  aloud and did not land ("maybe we try it both ways"). Be honest here; an
  open question drawn as a decision is worse than not drawing it.
- **kind** — one of: `breath`, `notes-rests`, `balance`, `tone-vowel`,
  `pitch`, `character`, `rubato-tempo`, `staging`, `open-question`.
- **scope** — the voice parts addressed, as an array from `tenor`, `lead`,
  `baritone`, `bass`. Use `null` when it applies to everyone. Do not guess a
  part from the musical content; only use what the director addressed.
- **topic** — the conflict key, like `breath:m162` or `tempo:chorus2`. Two
  instructions about the same thing in the same place must share a topic, so
  that a later rehearsal supersedes an earlier one instead of both being
  drawn. This is the field that keeps the score from filling up with
  contradictions.
- **quote** — the transcript words this came from, so a human reviewing it can
  check you.

**Name the lyric, in quotes, whenever the instruction attaches to one.** Write
`cut off 'quicker' cleanly` rather than `cut off that word cleanly`. The score
carries its lyrics as text, so a quoted lyric can be matched back to the bar it
is sung at — which is often the only way a note reaches the page at all when
the director never said a number. An unquoted paraphrase cannot be matched and
the note stays unplaceable.
- **at_s** — seconds into the recording, when you can tell.

## The transcript is auto-captioned and wrong in predictable ways

Bar numbers are misheard: "measure one sixty two" may arrive as "measure 162",
"160 to", or "one six two". Lyrics are mangled — one recording rendered
"Cruella De Vil" as "relative ill" five times. Voice parts get mangled too:
"bari" as "buried" or "berry", "tenor" as "tener".

When you are unsure of a bar number, set `measure` to null and say in the text
what the director anchored it to. **A marking with no bar is still useful; a
marking on the wrong bar is worse than none**, because it will be drawn on the
score and a singer will pencil it in.

Everything you write goes to a human for review before it reaches anyone, so
flag your uncertainty in the text rather than resolving it silently.
