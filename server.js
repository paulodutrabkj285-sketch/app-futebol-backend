const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

let db;
let firebaseProjectId = null;

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não definida");

  const serviceAccount = JSON.parse(raw);
  firebaseProjectId = serviceAccount.project_id;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  db = admin.firestore();

  console.log("Firebase inicializado:", firebaseProjectId);
} catch (error) {
  console.error("Erro Firebase:", error.message);
}

let agent;
try {
  const certificado = Buffer.from(process.env.CERTIFICADO_BASE64, "base64");

  agent = new https.Agent({
    pfx: certificado,
    passphrase: process.env.CERTIFICADO_SENHA || "",
  });
} catch (error) {
  console.error("Erro certificado:", error.message);
}

function gerarTxid() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let txid = "";
  for (let i = 0; i < 30; i++) {
    txid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return txid;
}

/* ===== TESTES ===== */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Backend online vOK",
    projetoFirebase: firebaseProjectId,
  });
});

app.get("/debug/firebase", async (req, res) => {
  try {
    await db.collection("debug_backend").doc("teste").set({
      status: "ok",
      data: new Date(),
    });

    res.json({
      ok: true,
      mensagem: "Firestore OK",
    });
  } catch (error) {
    res.status(500).json({
      erro: error.message,
    });
  }
});

/* ===== PIX ===== */

app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf } = req.body;

    const tokenResponse = await axios.post(
      "https://pix.api.efipay.com.br/oauth/token",
      { grant_type: "client_credentials" },
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

    const cobranca = await axios.put(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        calendario: { expiracao: 3600 },
        devedor: { cpf, nome },
        valor: { original: Number(valor).toFixed(2) },
        chave: process.env.PIX_KEY,
      },
      {
        httpsAgent: agent,
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const locId = cobranca.data.loc.id;

    const qrCode = await axios.get(
      `https://pix.api.efipay.com.br/v2/loc/${locId}/qrcode`,
      {
        httpsAgent: agent,
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    await db.collection("cobrancas").doc(txid).set({
      nome,
      cpf,
      valor,
      txid,
      status: "pendente",
      criadoEm: new Date(),
    });

    res.json({
      sucesso: true,
      copiaecola: qrCode.data.qrcode,
    });
  } catch (error) {
    console.log("Erro PIX:", error.message);

    res.status(500).json({
      erro: error.message,
    });
  }
});

/* ===== SERVER ===== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});