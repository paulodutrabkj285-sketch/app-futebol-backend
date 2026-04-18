const express = require("express");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const https = require("https");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// =========================
// FIREBASE ADMIN
// =========================
if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    const localServiceAccountPath = path.join(__dirname, "serviceAccountKey.json");

    if (fs.existsSync(localServiceAccountPath)) {
      const serviceAccount = require(localServiceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      throw new Error(
        "Credenciais Firebase não encontradas. Defina FIREBASE_SERVICE_ACCOUNT_JSON ou use serviceAccountKey.json."
      );
    }
  }
}

const db = admin.firestore();

// =========================
// CONFIGURAÇÕES EFI
// =========================
const EFI_CLIENT_ID = "Client_Id_aec6183933b5525a3eb935c9652372bb7439f8d6";
const EFI_CLIENT_SECRET = "Client_Secret_bb88b9e3f06b2e96d1ca463c93c2a0a567361703";
const EFI_PIX_KEY = "juniordutrabkj285@gmail.com";

// IMPORTANTE:
// troque pela URL real do seu backend no Render
const EFI_NOTIFICATION_URL =
  "https://app-futebol-backend.onrender.com/notificacao-efi";

// =========================
// AUXILIARES
// =========================
function somenteNumeros(valor = "") {
  return String(valor).replace(/\D/g, "");
}

function nomeMesAtual() {
  const meses = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  return meses[new Date().getMonth()];
}

function statusInternoPorStatusEfi(status) {
  const s = String(status || "").toLowerCase();

  if (s === "paid") return "Pago";
  if (s === "approved") return "Aprovado";
  if (s === "unpaid") return "Não pago";
  if (s === "canceled") return "Cancelado";
  if (s === "refunded") return "Estornado";
  if (s === "new" || s === "waiting" || s === "link") return "Pendente";

  return "Pendente";
}

function obterCertificadoBuffer() {
  const certPath = path.join(__dirname, "certificado.p12");

  if (!fs.existsSync(certPath)) {
    throw new Error("Arquivo certificado.p12 não encontrado na pasta do backend.");
  }

  return fs.readFileSync(certPath);
}

function criarHttpsAgent(certBuffer) {
  return new https.Agent({
    pfx: certBuffer,
    passphrase: "",
  });
}

// =========================
// TOKEN EFI PIX
// =========================
async function obterTokenPixEfi() {
  const certBuffer = obterCertificadoBuffer();
  const agent = criarHttpsAgent(certBuffer);

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
// TOKEN EFI COBRANÇAS
// =========================
async function obterTokenCobrancasEfi() {
  const certBuffer = obterCertificadoBuffer();
  const agent = criarHttpsAgent(certBuffer);

  const auth = Buffer.from(
    `${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    "https://cobrancas.api.efipay.com.br/v1/authorize",
    {},
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
// ATUALIZA STATUS DO JOGADOR
// =========================
async function atualizarStatusJogadorPagamento({
  jogadorId,
  mes,
  pago,
}) {
  if (!jogadorId || !mes) return;

  await db.collection("jogadores").doc(jogadorId).set(
    {
      pagamentos: {
        [mes]: pago === true,
      },
    },
    { merge: true }
  );
}

// =========================
// SALVAR MENSALIDADE
// =========================
async function salvarMensalidadeBase({
  jogadorId,
  nome,
  cpf,
  valor,
  mes,
  formaPagamento,
  txid = null,
  chargeId = null,
  paymentUrl = null,
  status = "Pendente",
  statusEfi = null,
  copiaecola = null,
  imagem = null,
  pago = false,
}) {
  const payload = {
    jogadorId: jogadorId || null,
    nome: nome || "",
    cpf: cpf || "",
    valor: Number(valor || 0),
    mes: mes || nomeMesAtual(),
    formaPagamento: formaPagamento || "pix",
    txid: txid || null,
    chargeId: chargeId || null,
    paymentUrl: paymentUrl || null,
    status: status || "Pendente",
    statusEfi: statusEfi || null,
    copia_e_cola: copiaecola || null,
    imagem: imagem || null,
    paga: pago === true,
    criadaEm: admin.firestore.FieldValue.serverTimestamp(),
    pagaEm: pago === true ? admin.firestore.FieldValue.serverTimestamp() : null,
  };

  const ref = await db.collection("mensalidades").add(payload);
  return ref.id;
}

// =========================
// ATUALIZAR MENSALIDADE POR CAMPO
// =========================
async function atualizarMensalidadePorCampo(campo, valorCampo, dados) {
  const snap = await db
    .collection("mensalidades")
    .where(campo, "==", valorCampo)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const doc = snap.docs[0];
  await doc.ref.update(dados);
  return doc.id;
}

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    mensagem: "Backend Gente Fera FC online",
  });
});

// =========================
// CRIAR PIX
// =========================
app.post("/criar-pix", async (req, res) => {
  try {
    const body = req.body || {};
    const { jogadorId, nome, valor, cpf, mes } = body;

    if (!nome || !valor || !cpf) {
      return res.status(400).json({
        sucesso: false,
        mensagem: "Campos obrigatórios: nome, valor e cpf",
        bodyRecebido: body,
      });
    }

    const { token, agent } = await obterTokenPixEfi();

    const cobranca = await axios.post(
      "https://pix.api.efipay.com.br/v2/cob",
      {
        calendario: { expiracao: 3600 },
        devedor: {
          nome: nome,
          cpf: somenteNumeros(cpf),
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

    const txid = cobranca.data.txid;
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

    await salvarMensalidadeBase({
      jogadorId,
      nome,
      cpf,
      valor,
      mes: mes || nomeMesAtual(),
      formaPagamento: "pix",
      txid,
      copiaecola: qr.data.qrcode,
      imagem: qr.data.imagemQrcode,
      status: "Pendente",
      statusEfi: cobranca.data.status || "ATIVA",
      pago: false,
    });

    return res.status(200).json({
      sucesso: true,
      txid,
      copiaecola: qr.data.qrcode,
      imagem: qr.data.imagemQrcode,
    });
  } catch (error) {
    console.error("ERRO PIX:", error.response?.data || error.message);

    return res.status(500).json({
      sucesso: false,
      erro: error.message,
      detalhe: error.response?.data || null,
    });
  }
});

// =========================
// VERIFICAR PAGAMENTO PIX
// =========================
app.get("/verificar-pagamento/:txid", async (req, res) => {
  try {
    const { txid } = req.params;

    if (!txid) {
      return res.status(400).json({
        ok: false,
        mensagem: "TXID não informado",
      });
    }

    const { token, agent } = await obterTokenPixEfi();

    const response = await axios.get(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const statusEfi = response.data.status;
    const pago = statusEfi === "CONCLUIDA";

    const snap = await db
      .collection("mensalidades")
      .where("txid", "==", txid)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      const dados = doc.data();

      await doc.ref.update({
        paga: pago,
        status: pago ? "Pago" : "Pendente",
        statusEfi,
        pagaEm: pago ? admin.firestore.FieldValue.serverTimestamp() : null,
      });

      if (pago && dados.jogadorId && dados.mes) {
        await atualizarStatusJogadorPagamento({
          jogadorId: dados.jogadorId,
          mes: dados.mes,
          pago: true,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      pago,
      statusEfi,
    });
  } catch (error) {
    console.error("ERRO VERIFICAR PIX:", error.response?.data || error.message);

    return res.status(500).json({
      ok: false,
      erro: error.message,
      detalhe: error.response?.data || null,
    });
  }
});

// =========================
// CRIAR LINK DE PAGAMENTO CARTÃO
// =========================
app.post("/criar-link-cartao", async (req, res) => {
  try {
    const body = req.body || {};
    const { jogadorId, nome, valor, cpf, email, telefone, mes } = body;

    if (!nome || !valor || !cpf) {
      return res.status(400).json({
        sucesso: false,
        mensagem: "Campos obrigatórios: nome, valor e cpf",
      });
    }

    const { token, agent } = await obterTokenCobrancasEfi();

    const payload = {
      items: [
        {
          name: `Mensalidade ${mes || nomeMesAtual()} - ${nome}`,
          value: Math.round(Number(valor) * 100),
          amount: 1,
        },
      ],
      payment: {
        credit_card: {
          customer: {
            name: nome,
            cpf: somenteNumeros(cpf),
            email: email || "cliente@gentefera.com",
            phone_number: somenteNumeros(telefone || "48999999999"),
          },
        },
      },
      metadata: {
        notification_url: EFI_NOTIFICATION_URL,
        custom_id: JSON.stringify({
          jogadorId: jogadorId || null,
          mes: mes || nomeMesAtual(),
          nome,
        }),
      },
    };

    const response = await axios.post(
      "https://cobrancas.api.efipay.com.br/v1/charge/one-step/link",
      payload,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = response.data?.data || response.data || {};
    const chargeId = data.charge_id || data.chargeId || data.id || null;
    const paymentUrl = data.payment_url || data.paymentUrl || null;

    await salvarMensalidadeBase({
      jogadorId,
      nome,
      cpf,
      valor,
      mes: mes || nomeMesAtual(),
      formaPagamento: "cartao",
      chargeId,
      paymentUrl,
      status: "Pendente",
      statusEfi: "link",
      pago: false,
    });

    return res.status(200).json({
      sucesso: true,
      chargeId,
      paymentUrl,
    });
  } catch (error) {
    console.error("ERRO CARTÃO:", error.response?.data || error.message);

    return res.status(500).json({
      sucesso: false,
      erro: error.message,
      detalhe: error.response?.data || null,
    });
  }
});

// =========================
// NOTIFICAÇÃO EFI
// =========================
app.post("/notificacao-efi", async (req, res) => {
  try {
    const tokenNotificacao =
      req.body?.notification ||
      req.body?.token ||
      req.query?.notification ||
      null;

    if (!tokenNotificacao) {
      return res.status(400).send("Token de notificação não enviado");
    }

    const { token, agent } = await obterTokenCobrancasEfi();

    const response = await axios.get(
      `https://cobrancas.api.efipay.com.br/v1/notification/${tokenNotificacao}`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const notificacoes = response.data?.data || [];

    for (const item of notificacoes) {
      const customIdBruto = item.custom_id || "{}";
      let customId = {};

      try {
        customId = JSON.parse(customIdBruto);
      } catch (_) {
        customId = {};
      }

      const chargeId =
        item.identifiers?.charge_id ||
        item.charge_id ||
        item.chargeId ||
        null;

      const statusEfi = item.status?.current || item.status || "new";
      const statusInterno = statusInternoPorStatusEfi(statusEfi);
      const pago = String(statusEfi).toLowerCase() === "paid";

      let mensalidadeId = null;

      if (chargeId) {
        mensalidadeId = await atualizarMensalidadePorCampo("chargeId", chargeId, {
          status: statusInterno,
          statusEfi,
          paga: pago,
          pagaEm: pago ? admin.firestore.FieldValue.serverTimestamp() : null,
        });
      }

      if (pago && customId.jogadorId && customId.mes) {
        await atualizarStatusJogadorPagamento({
          jogadorId: customId.jogadorId,
          mes: customId.mes,
          pago: true,
        });
      }

      console.log("Notificação processada:", {
        chargeId,
        statusEfi,
        statusInterno,
        mensalidadeId,
      });
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("ERRO NOTIFICAÇÃO EFI:", error.response?.data || error.message);
    return res.status(500).send("Erro ao processar notificação");
  }
});

// =========================
// HISTÓRICO DE PAGAMENTOS
// =========================
app.get("/historico-pagamentos/:jogadorId", async (req, res) => {
  try {
    const { jogadorId } = req.params;

    if (!jogadorId) {
      return res.status(400).json({
        ok: false,
        mensagem: "jogadorId não informado",
      });
    }

    const snap = await db
      .collection("mensalidades")
      .where("jogadorId", "==", jogadorId)
      .get();

    const historico = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    historico.sort((a, b) => {
      const ta = a.criadaEm?._seconds || 0;
      const tb = b.criadaEm?._seconds || 0;
      return tb - ta;
    });

    return res.status(200).json({
      ok: true,
      historico,
    });
  } catch (error) {
    console.error("ERRO HISTÓRICO:", error);
    return res.status(500).json({
      ok: false,
      erro: error.message,
    });
  }
});

// =========================
// TESTE FIRESTORE
// =========================
app.get("/teste-firestore", async (req, res) => {
  try {
    const snapshot = await db.collection("mensalidades").get();

    return res.status(200).json({
      sucesso: true,
      total: snapshot.size,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      sucesso: false,
      erro: error.message,
    });
  }
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});