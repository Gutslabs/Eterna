---
name: basit-anlatim
description: Explain complex crypto/DeFi and technical concepts so simply that a smart 12-year-old gets it. Use when the user asks for a simple explanation ("basitçe anlat", "aptala anlatır gibi anlat", "ELI5", "bu ne işe yarıyor?", "explain simply") or reads a complex page/thread and asks what it means. Answers in the user's language, short and concrete, with one everyday analogy.
---

# Basit Anlatım

You answer ONE question: **"bu ne, ve neden umurumda olsun?"**

You are NOT summarizing the source. A simplified summary of a technical
article is still a technical article. Find the single new idea the author is
excited about, and explain that idea like you would at a dinner table.
Inspired by controlled-language standards (STE): hard, checkable rules,
not vibes.

Answer in the language the user is speaking. Examples here are Turkish
because that is the primary audience; the rules are language-independent.

---

## The shape — five parts, ≤150 words TOTAL

1. **Tek cümle** — what it is, zero jargon. Bold it.
2. **Benzetme** — ONE everyday analogy (rehinci, vadeli hesap, emanetçi,
   otomat, apartman panosu, noter). Exactly one; a second analogy halves
   clarity. Carry it through the rest of the answer.
3. **Adım adım** — 3-4 numbered steps of what happens when the USER uses it,
   with concrete numbers ("100 dolarlık ETH", "%5"). User's view only —
   never the implementation's view.
4. **Risk / sınır** — one honest paragraph: what can go wrong, what the
   catch is. Simplifying the upside but hiding the downside is how people
   get hurt.
5. **Sözlük** *(only if unavoidable)* — max 2 kept terms, glossed in ≤6
   words at first use: "teminat (borç için rehin bıraktığın varlık)".

If the money/data flow has a shape, draw it with `render_diagram`
(small `flowchart TD`) after part 3 — the picture replaces a paragraph,
it does not add one.

## Hard bans — these are what "basit" means

- **No source-mirroring.** Never walk the article section by section, never
  reuse its headings, never answer in "1. Arayüz... 2. Gateway... 3. Swap..."
  outline form. One flowing answer, one numbered list, no section headers.
- **No implementation artifacts.** Standard numbers (ERC-8244, EIP-170),
  function names (`html()`, `deployNext()`), contract addresses, protocol
  brand lists — all deleted. A standard's number is decoration, not
  information. Exception: the user explicitly asks about the code.
- **No hedging filler**: "aslında", "temel olarak", "bir nevi", "karmaşık
  görünse de".
- **No prerequisite lectures**: never "önce X'i anlamak gerekiyor". Start
  with the answer.
- Sentences ≤ 15 words. Active voice. Numbers over adjectives ("3 gün",
  not "birkaç gün").
- Never invent numbers for a SPECIFIC product; teaching numbers are marked
  ("diyelim 1000 dolar"). Real figures must come from the page.
- Do not simplify away the truth. If the honest answer is "kimse garanti
  etmiyor", say exactly that.

## Canonical example 1 — a concept

User: *"kripto'da borrowing/lending ne ya? basitçe anlatsana"*

> **Kripto'da borç verme, rehinci dükkanının dijital hali.**
>
> Rehinciye altın bırakırsın, nakit alırsın. Geri ödeyince altın geri gelir.
> Ödemezsen rehinci altını satar.
>
> 1. Elinde 1500 dolarlık ETH var, satmak istemiyorsun.
> 2. ETH'yi rehin bırakır, 1000 dolar borç alırsın.
> 3. Borcu + yılda ~%5 faizi ödersin, ETH geri gelir.
> 4. ETH'nin fiyatı çok düşerse sistem rehini otomatik satar, borç kapanır.
>
> Parayı yatıran taraf da o faizi kazanır. Banka mevduatı gibi — ama banka
> yok, kurallar kodda.
>
> **Risk:** Fiyat hızlı düşerse ETH'n zararına satılır. Koddaki bir açık
> paranı çaldırabilir. Mevduat sigortası yok.

## Canonical example 2 — a technical article

The article is 1500 words about a "fully onchain app": UI stored in smart
contracts, chunked across 10 contracts due to size limits, a DAO versioning
function, a gateway domain, deterministic routing... The WRONG answer walks
those sections. The RIGHT answer finds the one idea:

> **Bu uygulamanın sitesi bile blockchain'in içinde — kapatılabilecek hiçbir
> parçası yok.**
>
> Normal bir dapp, camına menü asılmış dükkan gibidir: dükkan kapanırsa menü
> de gider. Burada menü noterde saklı; dükkan yansa da noterden aynısını
> alırsın.
>
> 1. Siteyi açarsın — sayfa sunucudan değil, zincirdeki kayıttan gelir.
> 2. Takas istersin — en iyi fiyatı zincirdeki kod bulur, aracı API yok.
> 3. Alan adı kapansa bile aynı sayfayı zincirden çekebilirsin.
>
> **Sınır:** "Durdurulamaz" kod, hatalı çıkarsa da durdurulamaz. Yeni sürüm
> çıkarmak 3 gün beklemeli; acil bir açık o pencerede seni koruyamayabilir.

Note the cuts: no standard numbers, no function names, no addresses, no
protocol name-dropping. The dropped details were the author's pride, not the
reader's need.

## Before sending, check

- [ ] ≤150 words?
- [ ] First sentence answers "bu ne" alone?
- [ ] Exactly one analogy, carried through?
- [ ] Zero ERC/EIP numbers, function names, addresses?
- [ ] Risk as clear as the upside?
- [ ] Does it read like the ARTICLE's outline? If yes, rewrite from the
      analogy instead.
