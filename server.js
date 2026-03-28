const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

// ==========================
// EFI / CERTIFICADO
// ==========================
if (!process.env.CERTIFICADO_BASE64) {
  throw new Error("CERTIFICADO_BASE64 não configurado no ambiente.");
}

const certificado = Buffer.from(process.env.CERTIFICADO_BASE64, "base64");

const agent = new https.Agent({
  pfx: certificado,
  passphrase: process.env.CERTIFICADO_SENHA || "",
});

// ==========================
// FIREBASE ADMIN
// ==========================
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não configurado no ambiente.");
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ==========================
// FUNÇÕES AUXILIARES
// ==========================
function gerarTxid() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let txid = "";
  for (let i = 0; i < 30; i++) {
    txid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return txid;
}

async function gerarTokenEfi() {
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

  return tokenResponse.data.access_token;
}

// ==========================
// ROTA TESTE
// ==========================
app.get("/", (req, res) => {
  res.send("Backend PIX + Firestore rodando.");
});

// ==========================
// CRIAR PIX
// ==========================
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf } = req.body;

    if (!nome || !valor || !cpf) {
      return res.status(400).json({
        erro: "Campos obrigatórios",
        detalhe: "nome, valor e cpf são obrigatórios",
      });
    }

    const token = await gerarTokenEfi();
    const txid = gerarTxid();

    const cobranca = await axios.put(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        calendario: { expiracao: 3600 },
        devedor: {
          cpf,
          nome,
        },
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

    const qrCode = await axios.get(
      `https://pix.api.efipay.com.br/v2/loc/${locId}/qrcode`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    await db.collection("cobrancas").add({
      nome,
      cpf,
      valor: Number(valor),
      txid,
      status: "pendente",
      tipo: "pix",
      copiaecola: qrCode.data.qrcode,
      imagem: qrCode.data.imagemQrcode,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      pagoEm: null,
    });

    res.json({
      sucesso: true,
      txid,
      copiaecola: qrCode.data.qrcode,
      imagem: qrCode.data.imagemQrcode,
    });
  } catch (error) {
    console.log("ERRO COMPLETO /criar-pix:");
    console.log(error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao gerar PIX",
      detalhe: error.response?.data || error.message,
    });
  }
});

// ==========================
// WEBHOOK PIX
// ==========================
app.post("/webhook/efi/pix", async (req, res) => {
  try {
    console.log("Webhook recebido:");
    console.log(JSON.stringify(req.body, null, 2));

    const pixList = req.body?.pix;

    if (!Array.isArray(pixList) || pixList.length === 0) {
      return res.status(200).json({
        recebido: true,
        detalhe: "Sem lista pix no payload",
      });
    }

    for (const pix of pixList) {
      const txid = pix.txid;

      if (!txid) continue;

      const snapshot = await db
        .collection("cobrancas")
        .where("txid", "==", txid)
        .get();

      if (snapshot.empty) {
        console.log(`Nenhuma cobrança encontrada para txid ${txid}`);
        continue;
      }

      for (const doc of snapshot.docs) {
        await doc.ref.update({
          status: "pago",
          pagoEm: admin.firestore.FieldValue.serverTimestamp(),
          webhookRecebidoEm: admin.firestore.FieldValue.serverTimestamp(),
          webhookPayload: req.body,
        });
      }

      console.log(`Cobrança ${txid} atualizada para pago`);
    }

    return res.status(200).json({ recebido: true });
  } catch (error) {
    console.log("ERRO COMPLETO /webhook/efi/pix:");
    console.log(error.response?.data || error.message);

    return res.status(500).json({
      erro: "Erro ao processar webhook",
      detalhe: error.response?.data || error.message,
    });
  }
});

// ==========================
// CONFIGURAR WEBHOOK NA EFI
// ==========================
app.post("/configurar-webhook", async (req, res) => {
  try {
    const token = await gerarTokenEfi();

    const response = await axios.put(
      `https://pix.api.efipay.com.br/v2/webhook/${encodeURIComponent(
        process.env.PIX_KEY
      )}`,
      {
        webhookUrl: "https://app-futebol-backend.onrender.com/webhook/efi/pix",
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-skip-mtls-checking": "true",
        },
      }
    );

    res.json({
      sucesso: true,
      resposta: response.data,
    });
  } catch (error) {
    console.log("ERRO COMPLETO /configurar-webhook:");
    console.log(error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao configurar webhook",
      detalhe: error.response?.data || error.message,
    });
  }
});

// ==========================
// INICIAR SERVIDOR
// ==========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});