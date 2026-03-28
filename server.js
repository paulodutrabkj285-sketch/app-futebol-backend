const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const fs = require("fs");
const path = require("path");
const https = require("https");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp
  const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
  

// =========================
// COLE SUAS CREDENCIAIS AQUI
// =========================
const EFI_CLIENT_ID = "Client_Id_aec6183933b5525a3eb935c9652372bb7439f8d6";
const EFI_CLIENT_SECRET = "Client_Secret_bb88b9e3f06b2e96d1ca463c93c2a0a567361703";
const EFI_PIX_KEY = "juniordutrabkj285@gmail.com";

// =========================
// TOKEN EFI
// =========================
async function obterTokenEfi() {
  const certPath = path.join(__dirname, "certificado.p12");

  const certBuffer = fs.readFileSync(certPath);

  const agent = new https.Agent({
    pfx: certBuffer,
    passphrase: "",
  });

  const auth = Buffer.from(
    `${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    "https://pix.api.efipay.com.br/oauth/token",
    {
      grant_type: "client_credentials",
    },
    {
      httpsAgent: agent,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    }
  );

  return {
    token: response.data.access_token,
    agent,
  };
}

// =========================
// CRIAR COBRANÇA PIX
// =========================
exports.criarCobrancaPixEfiNovo = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({
          sucesso: false,
          mensagem: "Use método POST",
        });
      }

      const body =
  typeof req.body === "string"
    ? JSON.parse(req.body)
    : req.body || {};

const { jogadorId, nome, valor, cpf } = body;

if (!jogadorId || !nome || !valor || !cpf) {
  return res.status(400).json({
    sucesso: false,
    mensagem: "Campos obrigatórios",
    bodyRecebido: body,
  });
}

      const { token, agent } = await obterTokenEfi();

      const cobranca = await axios.post(
        "https://pix.api.efipay.com.br/v2/cob",
        {
          calendario: { expiracao: 3600 },
          devedor: {
            nome: nome,
            cpf: cpf.replace(/\D/g, ""),
          },
          valor: {
            original: Number(valor).toFixed(2),
          },
          chave: EFI_PIX_KEY,
          solicitacaoPagador: `Mensalidade do jogador ${nome}`,
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

      const qr = await axios.get(
        `https://pix.api.efipay.com.br/v2/loc/${locId}/qrcode`,
        {
          httpsAgent: agent,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const mensalidade = {
        jogadorId,
        nome,
        valor: Number(valor),
        cpf: cpf,
        txid: cobranca.data.txid,
        copia_e_cola: qr.data.qrcode,
        imagem: qr.data.imagemQrcode,
        criadaEm: admin.firestore.FieldValue.serverTimestamp(),
        paga: false,
      };

      await db.collection("mensalidades").add(mensalidade);

      return res.status(200).json({
        sucesso: true,
        dados: mensalidade,
      });
          return res.status(200).json({
        sucesso: true,
        dados: mensalidade,
      });
    } catch (error) {
      console.error("ERRO COMPLETO:", error);
      console.error("ERRO RESPONSE DATA:", error.response?.data);
      console.error("ERRO MESSAGE:", error.message);

      return res.status(500).json({
        sucesso: false,
        erro: error.message,
        detalhes: error.response?.data || null,
        stack: error.stack || null,
      });
    }
  });
});

// =========================
// LISTAR
// =========================
exports.testeFirestore = functions.https.onRequest(async (req, res) => {
  try {
    const db = admin.firestore();

    const snapshot = await db.collection("mensalidades").get();

    return res.status(200).json({
      sucesso: true,
      total: snapshot.size
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      sucesso: false,
      erro: error.message
    });
  }
});