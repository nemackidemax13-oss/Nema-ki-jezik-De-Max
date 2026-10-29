// DE-MAX Tutin — Cloudflare Worker for course registrations.
// URL after deployment: https://demax-prijave.nemackidemax13.workers.dev/prijava
// Delivery options:
// 1. Set RESEND_API_KEY (secret) and optionally RESEND_FROM (plain variable).
// 2. OR bind Cloudflare Email Service as EMAIL and set EMAIL_FROM.
// Never place keys in GitHub or in the browser.
const ORIGIN = "https://nemackidemax13-oss.github.io";
const RECIPIENT = "nemackidemax13@gmail.com";

function headers(origin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin === ORIGIN) {
    h["Access-Control-Allow-Origin"] = ORIGIN;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS, GET";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function reply(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}

function clean(value, maxLength) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\r\n\t\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: headers(origin) })
        : reply({ ok: false, error: "Nedozvoljen izvor." }, 403, origin);
    }

    if (url.pathname === "/health" && request.method === "GET") {
      const configured = Boolean(
        (env.EMAIL && env.EMAIL_FROM) || env.RESEND_API_KEY
      );
      return reply(
        { ok: true, configured, service: "De-Max prijave" },
        200,
        origin
      );
    }

    if (url.pathname !== "/prijava") {
      return reply({ ok: false, error: "Nepoznata putanja." }, 404, origin);
    }
    if (request.method !== "POST") {
      return reply({ ok: false, error: "Koristite POST." }, 405, origin);
    }

    // Browser may submit only from the official De-Max GitHub Pages origin.
    // This is a helpful restriction, not a substitute for bot protection.
    if (origin !== ORIGIN) {
      return reply({ ok: false, error: "Nedozvoljen izvor." }, 403, origin);
    }
    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      return reply({ ok: false, error: "Očekivan je JSON." }, 415, origin);
    }
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 8192) {
      return reply({ ok: false, error: "Prijava je prevelika." }, 413, origin);
    }

    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 8192) {
        return reply({ ok: false, error: "Prijava je prevelika." }, 413, origin);
      }
      payload = JSON.parse(raw);
      if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        throw new Error("Bad input");
      }
    } catch {
      return reply({ ok: false, error: "Neispravni podaci." }, 400, origin);
    }

    // Invisible honeypot is present in the frontend. Do not send spam.
    if (clean(payload._honey, 100)) {
      return reply({ ok: true }, 200, origin);
    }

    const ime = clean(payload.ime, 65);
    const prezime = clean(payload.prezime, 65);
    const telefon = clean(payload.telefon, 40);
    const nivo = clean(payload.nivo, 5);
    const tempo = clean(payload.tempo, 15);
    const format = clean(payload.format, 15);

    if (
      !ime || !prezime ||
      !["A1", "A2", "B1"].includes(nivo) ||
      !["Standardni", "Intenzivni"].includes(tempo) ||
      !["Online", "Učionica"].includes(format) ||
      (nivo !== "A1" && (format !== "Online" || tempo !== "Standardni")) ||
      (format === "Učionica" && (nivo !== "A1" || tempo !== "Standardni"))
    ) {
      return reply({ ok: false, error: "Proverite podatke prijave." }, 400, origin);
    }

    // Optional Cloudflare Turnstile validation. Set TURNSTILE_SECRET only
    // after adding a real widget and sending its turnstileToken from the form.
    if (env.TURNSTILE_SECRET) {
      const token = clean(payload.turnstileToken, 4096);
      if (!token) {
        return reply({ ok: false, error: "Potvrdite da niste robot." }, 400, origin);
      }
      const body = new FormData();
      body.append("secret", env.TURNSTILE_SECRET);
      body.append("response", token);
      body.append("remoteip", request.headers.get("CF-Connecting-IP") || "");
      let verification;
      try {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body,
        });
        verification = await response.json();
      } catch {
        return reply({ ok: false, error: "Provera zaštite nije dostupna." }, 503, origin);
      }
      if (!verification.success) {
        return reply({ ok: false, error: "Zaštitna provera nije uspela." }, 403, origin);
      }
    }

    const termin = format === "Učionica" ? "23.11.2026." : "16.11.2026.";
    const subject = "Nova De-Max prijava — " + nivo + " — " + ime + " " + prezime;
    const text = [
      "Nova prijava za kurs nemačkog jezika — DE-MAX TUTIN",
      "",
      "Ime: " + ime,
      "Prezime: " + prezime,
      "Telefon: " + (telefon || "Nije unet"),
      "Nivo: " + nivo,
      "Kurs: " + tempo,
      "Pohađanje: " + format,
      "Početak: " + termin,
      "",
      "Prijava sa sajta nemackidemax13-oss.github.io",
    ].join("\n");

    try {
      if (env.EMAIL && env.EMAIL_FROM) {
        // Cloudflare Email Service: EMAIL send binding and verified FROM domain.
        await env.EMAIL.send({
          from: env.EMAIL_FROM,
          to: RECIPIENT,
          subject,
          text,
        });
      } else if (env.RESEND_API_KEY) {
        // Resend free testing sender can normally send only to the account owner;
        // for production use a verified sending domain and RESEND_FROM.
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.RESEND_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.RESEND_FROM || "De-Max Tutin <onboarding@resend.dev>",
            to: [RECIPIENT],
            subject,
            text,
          }),
        });
        if (!response.ok) {
          console.error("Resend API error status:", response.status);
          return reply(
            { ok: false, error: "Mejl servis trenutno nije potvrdio slanje." },
            502, origin
          );
        }
        const sent = await response.json();
        if (!sent.id) throw new Error("Email service did not return an ID.");
      } else {
        return reply(
          { ok: false, error: "Administrator nije podesio slanje mejla." },
          503, origin
        );
      }
      return reply({ ok: true, message: "Prijava je prihvaćena za slanje." }, 200, origin);
    } catch (error) {
      console.error("De-Max prijava failed:", error?.message || error);
      return reply(
        { ok: false, error: "Prijava nije potvrđena. Kontaktirajte nas direktno." },
        502, origin
      );
    }
  },
};
