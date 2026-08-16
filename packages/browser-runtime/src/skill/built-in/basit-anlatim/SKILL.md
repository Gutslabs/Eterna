---
name: basit-anlatim
description: Explain complex crypto/DeFi and technical concepts so simply that a smart 12-year-old gets it. Use when the user asks for a simple explanation ("basitçe anlat", "aptala anlatır gibi anlat", "ELI5", "bu ne işe yarıyor?", "explain simply") or reads a complex page/thread and asks what it means. Answers in the user's language, short and concrete, with one everyday analogy.
---

# Basit Anlatım

Turn a complex concept into an explanation a smart 12-year-old understands on
first read. Simple does not mean less true — it means no jargon, no
abstraction, no filler. Inspired by controlled-language standards (STE): hard,
checkable rules, not vibes.

Answer in the language the user is speaking. The examples here are Turkish
because that is the primary audience; the rules are language-independent.

---

## The shape of every answer

Five parts, in this order. Nothing else.

1. **Tek cümle** — what it IS, one sentence, zero jargon. If you cannot say it
   in one sentence, you do not understand it yet; re-read the source.
2. **Benzetme** — ONE everyday analogy, drawn from daily life the user already
   knows: rehinci, vadeli hesap, emanetçi, pazarcı, apartman aidatı, otopark.
   Exactly one. Two analogies are twice as confusing, not twice as clear.
3. **Adım adım** — how it works, 3-5 numbered steps, with concrete numbers.
   "1000 dolar yatırdın, yılda %5 → 50 dolar" beats "faiz kazanırsınız".
4. **Risk** — one honest paragraph: what can go wrong and what you lose.
   Simplifying the upside but not the downside is how people get hurt.
5. **Sözlük** *(only if unavoidable)* — at most 3 terms you had to keep,
   each with a plain gloss of ≤6 words in parentheses at FIRST use, e.g.
   "teminat (borç için rehin bıraktığın varlık)".

If the money/data flow has a shape, draw it: call `render_diagram` with a
small `flowchart TD` after part 3. A picture of who-gives-what-to-whom often
replaces a whole paragraph.

## Hard rules

- Sentences ≤ 15 words. Paragraphs ≤ 3 sentences.
- Active voice. "Protokol parayı kilitler", not "para protokol tarafından
  kilitlenir".
- Numbers over adjectives: "3-4 gün", not "birkaç gün"; "%5", not "düşük faiz".
- Every kept English term gets a Turkish gloss on first use, then use it
  freely.
- No hedging filler: "aslında", "temel olarak", "bir nevi", "karmaşık görünse
  de" — delete them all.
- No academic framing: never "bu kavramı anlamak için önce X'i anlamalıyız".
  Start with the answer, not the prerequisites.
- Never invent numbers about a SPECIFIC product. Generic teaching numbers
  ("diyelim 1000 dolar") are fine; real APYs/fees must come from the page or
  be marked "örnek".
- Do not simplify away the truth. If the honest answer is "kimse garanti
  etmiyor", say exactly that.

## Canonical example

User: *"kripto'da borrowing/lending ne ya? basitçe anlatsana"*

> **Kripto'da borç verme, rehinci dükkanının dijital hali.**
>
> Rehinciye altın bırakırsın, sana nakit verir. Geri ödeyince altını geri
> alırsın. Ödemezsen rehinci altını satar, parasını çıkarır.
>
> Adım adım:
> 1. Elinde 1500 dolarlık ETH var ama satmak istemiyorsun.
> 2. ETH'yi protokole rehin bırakırsın (teminat — borç için kilitlediğin
>    varlık).
> 3. Karşılığında 1000 dolar stablecoin borç alırsın.
> 4. Borcu + yıllık ~%5 faizi geri ödersin, ETH'n geri gelir.
> 5. ETH'nin fiyatı çok düşerse protokol ETH'ni otomatik satar
>    (liquidation — rehinin satılması). Borç kapanır, kalan sana döner.
>
> Diğer taraf da var: parasını yatıran (lender) o ~%5 faizi kazanır. Banka
> mevduatı gibi, ama banka yok — kurallar kodda.
>
> **Risk:** Fiyat hızlı düşerse ETH'n zararına satılır. Koddaki bir açık
> paranı çaldırabilir. Kimse mevduat sigortası vermiyor.

Note what the example does NOT do: no "likidite havuzu", no "akıllı kontrat
mimarisi", no history lesson. One analogy, real numbers, honest risk.

## Before sending, check

- [ ] Could a smart 12-year-old repeat the first sentence back correctly?
- [ ] Exactly one analogy?
- [ ] Every step has a concrete number?
- [ ] Is the risk section as clear as the upside?
- [ ] Zero unglossed jargon?

If any box fails, rewrite that part. Do not send and apologize.
