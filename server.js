const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

/* =========================
   CONFIG EFI
========================= */
const EFI_NOTIFICATION_URL =
  "https://app-futebol-backend.onrender.com/notificacao-efi";

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

  const firebaseApp =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id,
        });

  db = getFirestore(firebaseApp, "(default)");

  console.log("✅ Firebase inicializado");
  console.log("📌 Projeto Firebase:", firebaseProjectId);
  console.log("📌 E-mail do cliente:", firebaseClientEmail);
  console.log("📌 ID do banco de dados: (padrão)");
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
   AUXILIARES
========================= */
function somenteNumeros(valor = "") {
  return String(valor).replace(/\D/g, "");
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

/* =========================
   TOKENS EFI
========================= */
async function obterTokenPix() {
  if (!agent) {
    throw new Error("Certificado EFI não carregado");
  }

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

  return tokenResponse.data.access_token;
}

async function obterTokenCobrancas() {
  if (!agent) {
    throw new Error("Certificado EFI não carregado");
  }

  const response = await axios.post(
    "https://cobrancas.api.efipay.com.br/v1/authorize",
    {},
    {
      httpsAgent: agent,
      auth: {
        username: process.env.EFI_CLIENT_ID,
        password: process.env.EFI_CLIENT_SECRET,
      },
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return response.data.access_token;
}

/* =========================
   HISTÓRICO / JOGADOR
========================= */
async function salvarHistoricoPagamento({
  txid,
  cobrancaSalva,
  statusEfi,
  cobrancaEfi,
}) {
  if (!db || !txid || !cobrancaSalva) return;

  const historicoRef = db.collection("historico_pagamentos").doc(String(txid));
  const historicoSnap = await historicoRef.get();

  if (historicoSnap.exists) {
    console.log(`ℹ️ Histórico do txid ${txid} já existe`);
    return;
  }

  const payloadHistorico = {
    txid: String(txid),
    jogadorid: cobrancaSalva.jogadorId || null,
    nome: cobrancaSalva.nome || null,
    cpf: cobrancaSalva.cpf || null,
    mes: cobrancaSalva.mes || null,
    valor: cobrancaSalva.valor || null,
    status: "pago",
    statusEfi: statusEfi || "CONCLUIDA",
    formaPagamento: cobrancaSalva.formaPagamento || "pix",
    tipo: cobrancaSalva.tipo || cobrancaSalva.formaPagamento || "pix",
    pagoEm: FieldValue.serverTimestamp(),
    criadoEm: FieldValue.serverTimestamp(),
    cobrancaId: cobrancaSalva.chargeId || txid,
    loc: cobrancaSalva.loc || null,
    pixCopiaECola: cobrancaSalva.pixCopiaECola || null,
    paymentUrl: cobrancaSalva.paymentUrl || null,
    origem: "backend",
    retornoConsulta: cobrancaEfi || null,
  };

  await historicoRef.set(payloadHistorico, { merge: true });
  console.log(`✅ Histórico salvo em historico_pagamentos/${txid}`);
}

async function atualizarJogadorComoPago(cobrancaSalva) {
  if (!db || !cobrancaSalva?.jogadorId || !cobrancaSalva?.mes) {
    return;
  }

  await db
    .collection("jogadores")
    .doc(cobrancaSalva.jogadorId)
    .set(
      {
        [`pagamentos.${cobrancaSalva.mes}`]: true,
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  console.log(
    `✅ Jogador ${cobrancaSalva.jogadorId} marcado como pago em ${cobrancaSalva.mes}`
  );
}

/* =========================
   TESTES
========================= */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Backend online vOK",
    projetoFirebase: firebaseProjectId,
    clientEmail: firebaseClientEmail,
    databaseId: "(default)",
  });
});

app.get("/debug/firebase", async (req, res) => {
  const info = {
    envProjectId: firebaseProjectId,
    envClientEmail: firebaseClientEmail,
    databaseId: "(default)",
  };

  try {
    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
        info,
      });
    }

    const snapshot = await db.collection("cobrancas").limit(1).get();

    await db.collection("debug_backend").doc("teste").set(
      {
        status: "ok",
        atualizadoEm: FieldValue.serverTimestamp(),
        origem: "debug/firebase",
      },
      { merge: true }
    );

    return res.json({
      ok: true,
      mensagem: "Firestore OK",
      info,
      cobrancasCount: snapshot.size,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: error.message,
      code: error.code || null,
      details: error.details || null,
      info,
    });
  }
});

/* =========================
   CRIAR PIX
========================= */
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf, jogadorId, mes } = req.body;

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

    const token = await obterTokenPix();
    const txid = gerarTxid();

    const cobranca = await axios.put(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        calendario: { expiracao: 3600 },
        devedor: {
          cpf: somenteNumeros(cpf),
          nome,
        },
        valor: {
          original: Number(valor).toFixed(2),
        },
        chave: process.env.PIX_KEY,
        solicitacaoPagador: mes
          ? `Mensalidade do time - ${mes}`
          : "Mensalidade do time",
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

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

    const payload = {
      nome,
      cpf: somenteNumeros(cpf),
      valor: Number(valor),
      txid,
      jogadorId: jogadorId || null,
      mes: mes || null,
      status: "pendente",
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp(),
      efiStatus: cobranca.data?.status || null,
      loc: cobranca.data?.loc || null,
      pixCopiaECola: qrCode.data?.qrcode || null,
      imagemQrcode: qrCode.data?.imagemQrcode || null,
      tipo: "pix",
      formaPagamento: "pix",
    };

    await db.collection("cobrancas").doc(txid).set(payload, { merge: true });

    return res.json({
      sucesso: true,
      txid,
      copiaecola: qrCode.data?.qrcode || null,
      imagem: qrCode.data?.imagemQrcode || null,
    });
  } catch (error) {
    console.log("❌ ERRO PIX:", error.message);

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
   VERIFICAR PAGAMENTO PIX
========================= */
app.get("/verificar-pagamento/:txid", async (req, res) => {
  try {
    const { txid } = req.params;

    if (!txid) {
      return res.status(400).json({
        ok: false,
        erro: "TXID não informado",
      });
    }

    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
      });
    }

    const token = await obterTokenPix();

    const response = await axios.get(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const cobrancaEfi = response.data;
    const statusEfi = cobrancaEfi?.status || null;
    const foiPago = statusEfi === "CONCLUIDA";

    const cobrancaRef = db.collection("cobrancas").doc(txid);
    const cobrancaSnap = await cobrancaRef.get();
    const cobrancaSalva = cobrancaSnap.exists ? cobrancaSnap.data() : null;

    if (foiPago) {
      await cobrancaRef.set(
        {
          status: "pago",
          efiStatus: statusEfi,
          pagoEm: FieldValue.serverTimestamp(),
          atualizadoEm: FieldValue.serverTimestamp(),
          retornoConsulta: cobrancaEfi,
        },
        { merge: true }
      );

      if (cobrancaSalva) {
        await atualizarJogadorComoPago(cobrancaSalva);
        await salvarHistoricoPagamento({
          txid,
          cobrancaSalva,
          statusEfi,
          cobrancaEfi,
        });
      }
    } else {
      await cobrancaRef.set(
        {
          efiStatus: statusEfi,
          atualizadoEm: FieldValue.serverTimestamp(),
          retornoConsulta: cobrancaEfi,
        },
        { merge: true }
      );
    }

    return res.json({
      ok: true,
      txid,
      statusEfi,
      pago: foiPago,
      cobranca: cobrancaEfi,
    });
  } catch (error) {
    console.log("❌ Erro ao verificar pagamento:", error.message);

    if (error.response) {
      console.log("❌ STATUS EFI:", error.response.status);
      console.log("❌ DATA EFI:", JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      ok: false,
      erro: "Erro ao verificar pagamento",
      detalhe: error.response?.data || error.message,
      code: error.code || null,
      details: error.details || null,
    });
  }
});

/* =========================
   WEBHOOK EFI PIX
========================= */
app.post("/webhook/efi/pix", async (req, res) => {
  try {
    const pixRecebido = req.body?.pix;

    console.log("📥 Webhook recebido:", JSON.stringify(req.body, null, 2));

    if (!pixRecebido) {
      return res.sendStatus(200);
    }

    for (const pagamento of pixRecebido) {
      const txid = pagamento.txid;
      if (!txid) continue;

      const cobrancaRef = db.collection("cobrancas").doc(txid);
      const cobrancaSnap = await cobrancaRef.get();
      const cobrancaSalva = cobrancaSnap.exists ? cobrancaSnap.data() : null;

      await cobrancaRef.set(
        {
          status: "pago",
          pagoEm: FieldValue.serverTimestamp(),
          atualizadoEm: FieldValue.serverTimestamp(),
          webhookBruto: pagamento,
          efiStatus: "CONCLUIDA",
        },
        { merge: true }
      );

      if (cobrancaSalva) {
        await atualizarJogadorComoPago(cobrancaSalva);
        await salvarHistoricoPagamento({
          txid,
          cobrancaSalva,
          statusEfi: "CONCLUIDA",
          cobrancaEfi: pagamento,
        });
      }

      console.log("✅ Pagamento confirmado:", txid);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.log("Erro webhook:", error.message);
    return res.sendStatus(200);
  }
});

/* =========================
   CRIAR LINK DE PAGAMENTO CARTÃO
========================= */
app.post("/criar-link-cartao", async (req, res) => {
  try {
    const { nome, valor, cpf, jogadorId, mes, email, telefone } = req.body;

    console.log("➡️ /criar-link-cartao body:", req.body);

    if (!nome || !valor || !cpf) {
      return res.status(400).json({
        sucesso: false,
        mensagem: "Campos obrigatórios: nome, valor e cpf",
      });
    }

    if (!db) {
      return res.status(500).json({
        sucesso: false,
        mensagem: "Firestore não inicializado",
      });
    }

    const token = await obterTokenCobrancas();

    const payload = {
      items: [
        {
          name: `Mensalidade ${mes || nomeMesAtual()} - ${nome}`,
          value: Math.round(Number(valor) * 100),
          amount: 1,
        },
      ],
      metadata: {
        notification_url: EFI_NOTIFICATION_URL,
        custom_id: JSON.stringify({
          jogadorId: jogadorId || null,
          mes: mes || nomeMesAtual(),
          nome,
        }),
      },
      customer: {
        name: nome,
        email: email || "cliente@gentefera.com",
        cpf: somenteNumeros(cpf),
        phone_number: somenteNumeros(telefone || "48999999999"),
      },
      settings: {
        payment_method: "credit_card",
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

    if (!paymentUrl) {
      throw new Error("A Efí não retornou payment_url");
    }

    const docId = chargeId ? String(chargeId) : gerarTxid();

    await db.collection("cobrancas").doc(docId).set(
      {
        jogadorId: jogadorId || null,
        nome,
        cpf: somenteNumeros(cpf),
        valor: Number(valor),
        mes: mes || nomeMesAtual(),
        status: "pendente",
        efiStatus: "link",
        formaPagamento: "cartao",
        tipo: "cartao",
        chargeId,
        paymentUrl,
        email: email || "cliente@gentefera.com",
        telefone: telefone || null,
        criadoEm: FieldValue.serverTimestamp(),
        atualizadoEm: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({
      sucesso: true,
      chargeId,
      paymentUrl,
    });
  } catch (error) {
    console.log("❌ ERRO CARTÃO:", error.message);

    if (error.response) {
      console.log("❌ STATUS EFI:", error.response.status);
      console.log("❌ DATA EFI:", JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao gerar link de cartão",
      detalhe: error.response?.data || error.message,
    });
  }
});

/* =========================
   NOTIFICAÇÃO EFI CARTÃO
========================= */
app.post("/notificacao-efi", async (req, res) => {
  try {
    console.log(
      "📥 Notificação EFI recebida:",
      JSON.stringify(req.body, null, 2)
    );

    const tokenNotificacao =
      req.body?.notification ||
      req.body?.token ||
      req.query?.notification ||
      req.query?.token ||
      null;

    if (!tokenNotificacao) {
      return res.status(400).send("Token de notificação não enviado");
    }

    const token = await obterTokenCobrancas();

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

      let cobrancaRef = null;
      let cobrancaSnap = null;
      let cobrancaSalva = null;

      if (chargeId) {
        cobrancaRef = db.collection("cobrancas").doc(String(chargeId));
        cobrancaSnap = await cobrancaRef.get();

        if (cobrancaSnap.exists) {
          cobrancaSalva = cobrancaSnap.data();

          await cobrancaRef.set(
            {
              status: pago ? "pago" : statusInterno.toLowerCase(),
              efiStatus: statusEfi,
              atualizadoEm: FieldValue.serverTimestamp(),
              pagoEm: pago ? FieldValue.serverTimestamp() : null,
              retornoConsulta: item,
            },
            { merge: true }
          );
        } else {
          const querySnap = await db
            .collection("cobrancas")
            .where("chargeId", "==", chargeId)
            .limit(1)
            .get();

          if (!querySnap.empty) {
            cobrancaRef = querySnap.docs[0].ref;
            cobrancaSalva = querySnap.docs[0].data();

            await cobrancaRef.set(
              {
                status: pago ? "pago" : statusInterno.toLowerCase(),
                efiStatus: statusEfi,
                atualizadoEm: FieldValue.serverTimestamp(),
                pagoEm: pago ? FieldValue.serverTimestamp() : null,
                retornoConsulta: item,
              },
              { merge: true }
            );
          }
        }
      }

      const cobrancaFinal = cobrancaSalva || {
        jogadorId: customId.jogadorId || null,
        mes: customId.mes || null,
        nome: customId.nome || null,
        chargeId,
        formaPagamento: "cartao",
        tipo: "cartao",
      };

      if (pago && cobrancaFinal?.jogadorId && cobrancaFinal?.mes) {
        await atualizarJogadorComoPago(cobrancaFinal);

        await salvarHistoricoPagamento({
          txid: String(chargeId || gerarTxid()),
          cobrancaSalva: {
            ...cobrancaFinal,
            formaPagamento: "cartao",
            tipo: "cartao",
            chargeId,
          },
          statusEfi,
          cobrancaEfi: item,
        });
      }

      console.log("✅ Notificação processada:", {
        chargeId,
        statusEfi,
        statusInterno,
        pago,
      });
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.log("❌ ERRO NOTIFICAÇÃO EFI:", error.message);

    if (error.response) {
      console.log("❌ STATUS EFI:", error.response.status);
      console.log("❌ DATA EFI:", JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).send("Erro ao processar notificação");
  }
});

/* =========================
   HISTÓRICO POR JOGADOR
========================= */
app.get("/historico-pagamentos/:jogadorId", async (req, res) => {
  try {
    const { jogadorId } = req.params;

    if (!jogadorId) {
      return res.status(400).json({
        ok: false,
        erro: "jogadorId não informado",
      });
    }

    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
      });
    }

    const snapshot = await db
      .collection("historico_pagamentos")
      .where("jogadorid", "==", jogadorId)
      .orderBy("criadoEm", "desc")
      .get();

    const itens = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      ok: true,
      total: itens.length,
      historico: itens,
    });
  } catch (error) {
    console.log("❌ Erro ao listar histórico:", error.message);
    return res.status(500).json({
      ok: false,
      erro: "Erro ao listar histórico",
      detalhe: error.message,
    });
  }
});

/* =========================
   LISTAR PENDENTES
========================= */
app.get("/pendentes/:mes", async (req, res) => {
  try {
    const { mes } = req.params;

    if (!mes) {
      return res.status(400).json({
        ok: false,
        erro: "Mês não informado",
      });
    }

    if (!db) {
      return res.status(500).json({
        ok: false,
        erro: "Firestore não inicializado",
      });
    }

    const snapshot = await db.collection("jogadores").get();

    const pendentes = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((jogador) => jogador?.pagamentos?.[mes] !== true);

    return res.json({
      ok: true,
      mes,
      total: pendentes.length,
      pendentes,
    });
  } catch (error) {
    console.log("❌ Erro ao listar pendentes:", error.message);
    return res.status(500).json({
      ok: false,
      erro: "Erro ao listar pendentes",
      detalhe: error.message,
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
