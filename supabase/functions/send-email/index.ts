const allowedOrigins = new Set([
  "https://imoflow.pt",
  "https://www.imoflow.pt",
  "https://migfidalgo-droid.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

const allowedRoles = new Set([
  "Admin",
  "Broker",
  "Coordenadora de Agência",
  "Diretor de Agência",
  "Consultor Imobiliário",
  "Consultor em Formação",
  "Recrutador",
  "Gestor de Marketing",
]);

type SendEmailRequest = {
  to?: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  contactId?: string;
  templateKey?: string;
};

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://imoflow.pt";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function envValue(name: string) {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : "";
}

function secretKey() {
  const legacy = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(envValue("SUPABASE_SECRET_KEYS"));
    return keys.default || "";
  } catch {
    return "";
  }
}

function publishableKey() {
  const legacy = envValue("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(envValue("SUPABASE_PUBLISHABLE_KEYS"));
    return keys.default || "";
  } catch {
    return "";
  }
}

function normalizeRecipients(value: string | string[] | undefined) {
  const recipients = Array.isArray(value) ? value : [value || ""];
  return recipients.map(item => String(item).trim()).filter(Boolean);
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapEmailHtml(innerHtml: string) {
  return `<!doctype html>
<html lang="pt">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
  </head>
  <body style="margin:0;padding:0;background:#f3f6fa;color:#203040;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:94%;background:#ffffff;border:1px solid #d9e2ec;">
            <tr>
              <td style="background:#082b57;padding:18px 22px;color:#ffffff;">
                <img src="https://imoflow.pt/assets/remax-power-logo-white.png" alt="RE/MAX Power Benavente" style="height:54px;max-width:210px;object-fit:contain;display:block;">
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 22px;background:#eef3f8;color:#617083;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;text-align:center;">
                AMI 11846 - Conjugar Equilíbrios Mediação Imobiliária Lda<br>
                Cada agência é de propriedade e gestão independente<br>
                Gerado pelo ImoFlow
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function validateRequester(req: Request) {
  const supabaseUrl = envValue("SUPABASE_URL");
  const serviceRoleKey = secretKey();
  const anonKey = publishableKey() || serviceRoleKey;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return { error: "Configuração Supabase incompleta.", status: 500 };
  }
  if (!token) {
    return { error: "Sessão não encontrada.", status: 401 };
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": anonKey,
    },
  });
  if (!userResponse.ok) {
    return { error: "Sessão inválida ou expirada.", status: 401 };
  }

  const user = await userResponse.json();
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status,blocked_until,email`,
    {
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
        "Accept": "application/json",
      },
    },
  );
  if (!profileResponse.ok) {
    return { error: "Não foi possível validar permissões.", status: 403 };
  }

  const [profile] = await profileResponse.json();
  const blockedUntil = profile?.blocked_until ? new Date(profile.blocked_until) : null;
  if (!profile || profile.status !== "active" || (blockedUntil && blockedUntil > new Date())) {
    return { error: "Utilizador sem acesso ativo.", status: 403 };
  }
  if (!allowedRoles.has(profile.role)) {
    return { error: "Perfil sem permissão para enviar e-mails.", status: 403 };
  }

  return { user, profile };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Método não permitido." }, 405);
  }

  const requester = await validateRequester(req);
  if ("error" in requester) {
    return jsonResponse(req, { error: requester.error }, requester.status);
  }

  const resendApiKey = envValue("RESEND_API_KEY");
  if (!resendApiKey) {
    return jsonResponse(req, { error: "Chave Resend em falta no Supabase." }, 500);
  }

  let payload: SendEmailRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Pedido inválido." }, 400);
  }

  const recipients = normalizeRecipients(payload.to);
  const subject = String(payload.subject || "").trim();
  const text = String(payload.text || "").trim();
  const html = String(payload.html || "").trim();

  if (!recipients.length || recipients.length > 50) {
    return jsonResponse(req, { error: "Destinatário inválido." }, 400);
  }
  if (!subject) {
    return jsonResponse(req, { error: "Assunto em falta." }, 400);
  }
  if (!html && !text) {
    return jsonResponse(req, { error: "Mensagem em falta." }, 400);
  }

  const from = envValue("EMAIL_FROM") || "RE/MAX Power - ImoFlow <notificacoes@imoflow.pt>";
  const replyTo = envValue("EMAIL_REPLY_TO");
  const innerHtml = html || `<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`;
  const resendPayload: Record<string, unknown> = {
    from,
    to: recipients,
    subject,
    html: wrapEmailHtml(innerHtml),
    text,
  };
  if (replyTo) resendPayload.reply_to = replyTo;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendPayload),
  });
  const resendResult = await resendResponse.json().catch(() => ({}));

  if (!resendResponse.ok) {
    return jsonResponse(req, {
      error: resendResult?.message || "A Resend recusou o envio.",
      details: resendResult,
    }, 502);
  }

  return jsonResponse(req, {
    id: resendResult.id || "",
    to: recipients,
    sentAt: new Date().toISOString(),
  });
});
