const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

/* =========================
   FIREBASE (CORRIGIDO)
========================= */
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/* =========================
   CERTIFICADO EFI (BASE64)
========================= */
const certificado = Buffer.from(
  process.env.CERTIFICADO_BASE64,
  "base64"
);

const agent = new https.Agent({
  pfx: certificado,
  passphrase: "",
});

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
   CRIAR PIX + SALVAR FIRESTORE
========================= */
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf } = req.body;

    // TOKEN EFI
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

    // CRIAR COBRANÇA PIX
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

    const locId = cobranca.data.loc.id;

    // GERAR QR CODE
    const qrCode = await axios.get(
      `https://pix.api.efipay.com.br/v2/loc/${locId}/qrcode`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    /* =========================
       SALVAR NO FIRESTORE
    ========================= */
    await db.collection("cobrancas").add({
      nome,
      cpf,
      valor,
      txid,
      status: "pendente",
      criadoEm: new Date(),
    });

    res.json({
      sucesso: true,
      txid,
      copiaecola: qrCode.data.qrcode,
      imagem: qrCode.data.imagemQrcode,
    });
  } catch (error) {
    console.log("ERRO PIX:", error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao gerar PIX",
      detalhe: error.response?.data || error.message,
    });
  }
});

/* =========================
   WEBHOOK EFI
========================= */
app.post("/webhook/efi/pix", async (req, res) => {
  try {
    const pixRecebido = req.body?.pix;

    if (!pixRecebido) return res.sendStatus(200);

    for (const pagamento of pixRecebido) {
      const txid = pagamento.txid;

      const snapshot = await db
        .collection("cobrancas")
        .where("txid", "==", txid)
        .get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];

        await doc.ref.update({
          status: "pago",
          pagoEm: new Date(),
        });

        console.log("Pagamento confirmado:", txid);
      }
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