const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

/* =========================
   FIREBASE
========================= */
let db;
let firebaseProjectId = null;
let firebaseClientEmail = null;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não definida");
  }

  const serviceAccount = JSON.parse(raw);
  firebaseProjectId = serviceAccount.project_id || null;
  firebaseClientEmail = serviceAccount.client_email || null;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  db = admin.firestore();

  console.log("✅ Firebase inicializado");
  console.log("📌 Projeto Firebase:", firebaseProjectId);
  console.log("📌 Client email:", firebaseClientEmail);
} catch (error) {
  console.error("❌ Erro ao inicializar Firebase:", error.message);
}

/* =========================
   CERTIFICADO EFI
========================= */
let agent;

try {
  const certificado = Buffer.from(process.env.CERTIFICADO_BASE64, "base64");

  agent = new https.Agent({
    pfx: certificado,
    passphrase: process.env.CERTIFICADO_SENHA || "",
  });

  console.log("✅ Certificado EFI carregado");
} catch (error) {
  console.error("❌ Erro ao carregar certificado:", error.message);
}

/* =========================
   GERAR TXID
========================= */
function gerarTxid() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let txid = "";
  for (let i = 0; i < 30; i++) {
    txid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return txid;
}

/* =========================
   ROTAS DE TESTE
========================= */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Backend online vOK",
    projetoFirebase: firebaseProjectId,
    clientEmail: firebaseClientEmail,
  });
});

app.get("/debug/firebase", async (req, res) => {
  const info = {
    envProjectId: firebaseProjectId,
    envClientEmail: firebaseClientEmail,
  };

  try {
    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
        info,
      });
    }

    // teste 1: tentar ler uma coleção que já existe
    let cobrancasCount = null;
    try {
      const snapshot = await db.collection("cobrancas").limit(1).get();
      cobrancasCount = snapshot.size;
    } catch (readError) {
      return res.status(500).json({
        ok: false,
        etapa: "leitura_cobrancas",
        erro: readError.message,
        code: readError.code || null,
        details: readError.details || null,
        info,
      });
    }

    // teste 2: tentar gravar
    try {
      await db.collection("debug_backend").doc("teste").set(
        {
          status: "ok",
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          origem: "debug/firebase",
        },
        { merge: true }
      );
    } catch (writeError) {
      return res.status(500).json({
        ok: false,
        etapa: "escrita_debug_backend",
        erro: writeError.message,
        code: writeError.code || null,
        details: writeError.details || null,
        info,
        cobrancasCount,
      });
    }

    return res.json({
      ok: true,
      mensagem: "Firestore OK",
      info,
      cobrancasCount,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      etapa: "erro_geral",
      erro: error.message,
      code: error.code || null,
      details: error.details || null,
      info,
    });
  }
});

/* =========================
   CRIAR PIX + SALVAR FIRESTORE
========================= */
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf, jogadorId, mesReferencia } = req.body;

    console.log("➡️ /criar-pix body:", req.body);

    if (!nome || !valor || !cpf) {
      return res.status(400).json({
        ok: false,
        erro: "Campos obrigatórios: nome, valor, cpf",
      });
    }

    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
      });
    }

    const tokenResponse = await axios.post(
      "https://pix.api.efipay.com.br/oauth/token",
      {
        grant_type: "client_credentials",
      },
      {
        httpsAgent: agent,
        auth: {
          username: process.env.EFI_CLIENT_ID,
          password: process.env.EFI_CLIENT_SECRET,
        },
      }
    );

    const token = tokenResponse.data.access_token;
    const txid = gerarTxid();

    console.log("✅ Token EFI obtido");
    console.log("📌 TXID:", txid);

    const cobranca = await axios.put(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        calendario: { expiracao: 3600 },
        devedor: { cpf, nome },
        valor: {
          original: Number(valor).toFixed(2),
        },
        chave: process.env.PIX_KEY,
        solicitacaoPagador: "Mensalidade do time",
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Cobrança criada na EFI");

    const locId = cobranca.data?.loc?.id;
    if (!locId) {
      throw new Error("loc.id não retornado pela EFI");
    }

    const qrCode = await axios.get(
      `https://pix.api.efipay.com.br/v2/loc/${locId}/qrcode`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ QR Code gerado");

    const payload = {
      nome,
      cpf,
      valor: Number(valor),
      txid,
      jogadorId: jogadorId || null,
      mesReferencia: mesReferencia || null,
      status: "pendente",
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      efiStatus: cobranca.data?.status || null,
      loc: cobranca.data?.loc || null,
      pixCopiaECola: qrCode.data?.qrcode || null,
      imagemQrcode: qrCode.data?.imagemQrcode || null,
      tipo: "pix",
    };

    console.log("📝 Salvando no Firestore em cobrancas/" + txid);

    await db.collection("cobrancas").doc(txid).set(payload, { merge: true });

    console.log("✅ Salvo no Firestore com sucesso");

    return res.json({
      sucesso: true,
      txid,
      copiaecola: qrCode.data.qrcode,
      imagem: qrCode.data.imagemQrcode,
    });
  } catch (error) {
    console.log("❌ ERRO PIX:", error.message);
    console.log("❌ CODE:", error.code || null);
    console.log("❌ DETAILS:", error.details || null);

    if (error.response) {
      console.log("❌ STATUS EFI:", error.response.status);
      console.log("❌ DATA EFI:", JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      erro: "Erro ao gerar PIX",
      detalhe: error.response?.data || error.message,
      code: error.code || null,
      details: error.details || null,
    });
  }
});

/* =========================
   WEBHOOK EFI
========================= */
app.post("/webhook/efi/pix", async (req, res) => {
  try {
    const pixRecebido = req.body?.pix;

    console.log("📥 Webhook recebido:", JSON.stringify(req.body, null, 2));

    if (!pixRecebido) return res.sendStatus(200);

    for (const pagamento of pixRecebido) {
      const txid = pagamento.txid;
      if (!txid) continue;

      await db.collection("cobrancas").doc(txid).set(
        {
          status: "pago",
          pagoEm: admin.firestore.FieldValue.serverTimestamp(),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          webhookBruto: pagamento,
        },
        { merge: true }
      );

      console.log("✅ Pagamento confirmado:", txid);
    }

    res.sendStatus(200);
  } catch (error) {
    console.log("Erro webhook:", error.message);
    res.sendStatus(200);
  }
});

/* =========================
   CONFIGURAR WEBHOOK
========================= */
app.post("/configurar-webhook", async (req, res) => {
  try {
    const tokenResponse = await axios.post(
      "https://pix.api.efipay.com.br/oauth/token",
      {
        grant_type: "client_credentials",
      },
      {
        httpsAgent: agent,
        auth: {
          username: process.env.EFI_CLIENT_ID,
          password: process.env.EFI_CLIENT_SECRET,
        },
      }
    );

    const token = tokenResponse.data.access_token;

    const webhookUrl =
      "https://app-futebol-backend.onrender.com/webhook/efi/pix";

    await axios.put(
      `https://pix.api.efipay.com.br/v2/webhook/${process.env.PIX_KEY}`,
      {
        webhookUrl,
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    res.json({ sucesso: true, webhookUrl });
  } catch (error) {
    console.log("Erro webhook:", error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao configurar webhook",
      detalhe: error.response?.data || error.message,
    });
  }
});

/* =========================
   SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});