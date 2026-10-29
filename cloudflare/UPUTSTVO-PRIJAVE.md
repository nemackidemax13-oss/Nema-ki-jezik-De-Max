# De-Max Tutin — prijave preko Cloudflare Worker-a

Ovaj projekat **ne može automatski da šalje mejl dok Worker ne bude objavljen i povezan sa mejl servisom**. GitHub stranica je već pripremljena: sama proverava da li je novi Worker spreman, pa ga koristi umesto FormSubmit-a.

## 1. Objavi Worker

1. Otvori https://dash.cloudflare.com/ i uđi u **Workers & Pages**.
2. Klikni **Create** / **Create Worker**.
3. Naziv Workera upiši **demax-prijave** (važan je tačno ovaj naziv).
4. Otvori **Edit code** i zameni početni primer sadržajem datoteke `cloudflare/demax-prijave-worker.js` iz ovog repozitorijuma.
5. Klikni **Deploy**.

Ako je Workers poddomen `nemackidemax13.workers.dev`, adresa treba da bude:

- Formular API: `https://demax-prijave.nemackidemax13.workers.dev/prijava`
- Status: `https://demax-prijave.nemackidemax13.workers.dev/health`

Ako je Cloudflare poddomen na ovom nalogu drugačiji, promeni konstantu `WORKER_ENDPOINT` u `prijava-kurs.html`.

## 2. Aktiviraj slanje mejlova (jedan od dva načina)

### Opcija A — Resend (najbrža za prijave koje stižu na tvoj Gmail)

1. Otvori https://resend.com i napravi nalog pod adresom **nemackidemax13@gmail.com**, na koju stižu prijave.
2. Napravi **Sending access** API ključ u Resend → API Keys. **Ne unosi ključ u GitHub, HTML ili razgovor.**
3. U Cloudflare → Workers & Pages → **demax-prijave** → **Settings → Variables and Secrets** dodaj:
   - Name: `RESEND_API_KEY`
   - Type: **Secret**
   - Value: tvoj API ključ
4. Po potrebi dodaj `RESEND_FROM`, kao **Text** (varijabla, ne ključ). Dok testiraš sa mejlom kojim si se registrovao na Resend, Worker po podrazumevanju koristi `De-Max Tutin <onboarding@resend.dev>`.
5. Za trajnu produkcionu upotrebu preporučeno je da verifikuješ sopstveni domen u Resend i staviš `RESEND_FROM` na verifikovanu adresu, na primer `De-Max Tutin <prijave@tvoj-domen.rs>` (ovaj domen je samo primer).

Resend test domen je ograničen za slanje na odobrenu adresu naloga; ne predstavlja univerzalnog pošiljaoca za druge primaoce.

### Opcija B — Samo Cloudflare Email Service (ako imaš domen povezan sa Cloudflare)

1. U **Cloudflare Email Service** aktiviraj sending domen i potvrdi adresu `nemackidemax13@gmail.com` kao dozvoljenog primaoca.
2. U Worker pod **Settings → Bindings** dodaj binding tipa **Send Email**, pod imenom `EMAIL` i dozvoljenom destinacijom `nemackidemax13@gmail.com`.
3. U **Variables and Secrets** dodaj običnu promenljivu `EMAIL_FROM` sa adresom na aktiviranom domenu, na primer `prijave@tvoj-domen.rs`.

Cloudflare Email Service zahteva domen i odgovarajuće DNS podešavanje. Ova opcija ne koristi Resend.

## 3. Proveri

1. Otvori `https://demax-prijave.nemackidemax13.workers.dev/health` — treba da piše **"ok":true,"configured":true**.
2. Otvori **https://nemackidemax13-oss.github.io/Nema-ki-jezik-De-Max/prijava-kurs.html?v=8**, pošalji probnu prijavu i proveri Gmail (uključujući Spam).
3. Uspeh na ekranu znači da je Worker dobio potvrdu od mejl servisa da je poruka prihvaćena na slanje — **ne garantuje dostavljanje u Inbox**.
4. Ako servis nije podešen, frontend koristi prethodni FormSubmit dok Worker ne postane spreman. Ako nema potvrde, nudi direktno slanje mejlom.

## Napomene o bezbednosti

- Worker prihvata samo prijave sa domena `nemackidemax13-oss.github.io`, proverava sadržaj, dozvoljene nivoe, datume i honeypot polje.
- Za javni formular preporučena je dodatna **Cloudflare Turnstile** zaštita protiv botova. Kod Workera podržava `TURNSTILE_SECRET`, ali **nemoj ga uključivati dok se na formular ne doda Turnstile vidžet**.
- Nikada ne otkrivaj API ključ učenicima i ne unosi ga u HTML. 
- Slanje ne zavisi od OpenAI API ključa, a postojeće De-Max A1/A2/B1 Workere ne treba menjati.
