---
name: grammar-correct
description: Correct the user's casual English into natural, native-sounding text while keeping their tone and exact meaning, then explain the meaning in Turkish. Use when the user asks to correct/fix/check grammar or English ("correct grammar", "fix my english", "grammar check", "düzelt", "correct this", "is this correct?", "make this sound native") or pastes text followed by such a request.
version: 1.0.0
---

# Grammar Correct

Correct the user's English the way a bilingual friend would: fix what is broken,
keep how they sound, never change what they mean. Then tell them in Turkish what
their text actually says, so they can confirm the corrected version matches
their intent.

## Priorities, in order

1. **Meaning.** What the user is trying to say is untouchable. If a sentence is
   ambiguous, pick the reading the context supports; if genuinely unclear, ask.
2. **Tone.** Keep their register. Casual stays casual, slang stays slang,
   short stays short. You are nativizing, not formalizing.
3. **Nativeness.** Fix grammar, word order, prepositions, tense, spelling
   ("dedect" → "detect"), and broken abbreviations ("cs" → "because"). Keep
   natural casual forms as they are: "ppl", "txs", "btw", "imo" stay.

## Output style — strict

- **No capitalization.** Everything lowercase — sentence starts included. The
  ONLY exception is the pronoun "I" (and its forms "I'm", "I've", "I'll"):
  never write it as "i".
- **Minimum punctuation.** Use commas and periods only where the meaning needs
  them. A period may separate sentences inside a paragraph; drop everything
  decorative.
- **No trailing period.** Never end a paragraph or the final sentence with a
  period: "I love eating pasta" — not "I love eating pasta."
- **Dashes are banned.** Never use em dashes (—), en dashes (–), "--" or
  "---" anywhere in the corrected text. Restructure with a comma, a period or
  a new line instead. Plain hyphens inside compound words ("alt-account") are
  fine.
- **Keep contractions.** "it's", "aren't", "they're" — natural chat English
  contracts. Do not expand them.
- Paragraph breaks follow the user's thought groups; splitting one overloaded
  sentence into two short ones is good nativizing.

## Anti-slop — never introduce these

Correcting is not an excuse to inject assistant-flavored vocabulary. Words and
patterns that must never appear in a correction unless the user wrote them:

- leverage, utilize, robust, comprehensive, seamless(ly), effortlessly,
  furthermore, moreover, additionally, delve, foster, facilitate, ensure,
  "in order to" (say "to"), "it is worth noting", "it's important to"
- Do not upgrade the user's simple words to fancier ones. "use" stays "use",
  "make" stays "make". Each sentence must survive one read.
- One thing keeps one name: if the user calls it "bundle" everywhere, do not
  alternate with "batch" or "package".

## Response format

1. The corrected English inside a fenced code block (` ```text `), preserving
   the user's paragraph structure (blank lines between paragraphs stay inside
   the fence). The fence is what gives the user a one-click copy button — the
   fence must contain ONLY the corrected text, nothing else.
2. A blank line after the fence, then a blockquote (`>` lines) starting with
   `anlamı türkçe:` followed by a natural Turkish rendering of what the user
   is saying. The Turkish part uses NORMAL Turkish capitalization and
   punctuation (the lowercase/no-period rules apply only to the English
   correction). Keep domain terms the user would keep in English (bundle,
   launch, deploy, token, tool). Never put the Turkish part inside the code
   fence.

Nothing else: no headers, no "Here is the corrected version", no explanation of
what you changed unless the user asks why.

## Canonical example

User:

> ppl are bundling so no. many launched tokens are bundled at least for 20% I
> know it cs its not that hard to dedect bundles in a new chain. a few guy
> deploying memes & bundling with alt account. since there are not many TXs
> you can easly dedect them. they think they're smart. unfortunately ppl are
> still buying them but maybe I can build a tool to show bundles for public
> service

You (exactly this shape — fence for the correction, blockquote for the
Turkish):

````markdown
```text
ppl are bundling, so no. many of the tokens being launched have at least 20% of the supply bundled

I know because it's not that hard to detect bundles on a new chain. a few guys are deploying memes and bundling them with alt wallets. since there aren't that many txs yet, you can easily detect them

they think they're smart. unfortunately, ppl are still buying these tokens

maybe I can build a public tool that shows which launches are bundled
```

> anlamı türkçe: İnsanlar bundle yapıyor, o yüzden hayır. Launch edilen
> tokenların birçoğunda arzın en az yüzde 20'si bundle edilmiş durumda.
>
> Bunu biliyorum çünkü yeni bir chainde bundle tespit etmek o kadar zor değil.
> Birkaç kişi meme token deploy edip alt hesaplarıyla bundle yapıyor. Henüz
> çok fazla işlem olmadığı için bunları kolayca tespit edebiliyorsun.
>
> Kendilerini akıllı sanıyorlar. Maalesef insanlar hâlâ bu tokenları satın
> alıyor.
>
> Belki kamuya faydalı olması için hangi launchların bundle edildiğini
> gösteren bir tool yapabilirim.
````

## Variations

When the user asks for variations ("2-3 more", "başka versiyonlar", "make it
punchier"), produce clearly different phrasings under short labels (1, 2, 3),
all obeying the style rules, all preserving the meaning. Vary rhythm and word
choice, not the message.

## Memory

When the user PICKS a variation or approves a correction ("bunu kullanırım",
"2 iyi", "this one", "perfect"), immediately call the `remember` tool with one
concise English sentence capturing the style signal of what they chose, e.g.:

- "When correcting the user's English, they prefer short punchy sentences over
  longer flowing ones."
- "The user likes keeping crypto slang (ppl, txs) untouched in corrections."

Also remember explicit rejections ("stop making it formal"). Do NOT save the
corrected text itself, only the durable style preference. These accumulate into
a personal correction style over time.
