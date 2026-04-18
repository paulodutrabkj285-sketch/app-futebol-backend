const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const path = require("path");
const EfiPay = require("sdk-node-apis-efi");

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

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
  console.log("📌 Client email:", firebaseClientEmail);
  console.log("📌 Database ID: (default)");
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
   SDK EFI
========================= */
const efiOptions = {
  sandbox: false,
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: path.resolve(__dirname, "certificado.p12"),
};

const efipay = new EfiPay(efiOptions);

/* =========================
   AUXILIARES
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

function somenteNumeros(valor = "") {
  return String(valor).replace(/\D/g, "");
}

/* =========================
   SALVAR HISTÓRICO DE PAGAMENTO
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
    tipo: cobrancaSalva.tipo || "pix",
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

/* =========================
   ATUALIZAR JOGADOR COMO PAGO
========================= */
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
   ROTAS DE TESTE
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

    try {
      await db.collection("debug_backend").doc("teste").set(
        {
          status: "ok",
          atualizadoEm: FieldValue.serverTimestamp(),
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

    if (!agent) {
      return res.status(500).json({
        ok: false,
        erro: "Certificado EFI não carregado",
      });
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

    const token = tokenResponse.data.access_token;
    const txid = gerarTxid();

    console.log("✅ Token EFI obtido");
    console.log("📌 TXID:", txid);

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
    });
  }
});

/* =========================
   VERIFICAR PAGAMENTO POR TXID
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

    if (!agent) {
      return res.status(500).json({
        ok: false,
        erro: "Certificado EFI não carregado",
      });
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

    const token = tokenResponse.data.access_token;

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
   CRIAR LINK DE PAGAMENTO CARTÃO - SDK
========================= */
app.post("/criar-link-cartao", async (req, res) => {
  try {
    const { nome, valor, cpf, jogadorId, mes, email } = req.body;

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

    const body = {
      items: [
        {
          name: `Mensalidade ${mes || "Mensalidade"} - ${nome}`,
          value: Math.round(Number(valor) * 100),
          amount: 1,
        },
      ],
      metadata: {
        notification_url:
          "https://app-futebol-backend.onrender.com/notificacao-efi",
        custom_id: `jogador_${jogadorId || "semid"}_mes_${mes || "mensalidade"}`,
      },
      customer: {
        email: email || "juniordutrabkj285@gmail.com",
      },
      settings: {
        payment_method: "credit_card",
        request_delivery_address: false,
        expire_at: "2026-04-25",
      },
    };

    const response = await efipay.createOneStepLink({}, body);

    const data = response.data || response;
    const chargeId =
      data?.charge_id ||
      data?.chargeId ||
      data?.data?.charge_id ||
      null;

    const paymentUrl =
      data?.payment_url ||
      data?.paymentUrl ||
      data?.data?.payment_url ||
      null;

    await db.collection("cobrancas_cartao").add({
      jogadorId: jogadorId || null,
      nome,
      cpf: somenteNumeros(cpf),
      valor: Number(valor),
      mes: mes || null,
      chargeId,
      paymentUrl,
      status: "pendente",
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp(),
      formaPagamento: "cartao",
      tipo: "cartao",
    });

    return res.status(200).json({
      sucesso: true,
      chargeId,
      paymentUrl,
      dados: data,
    });
  } catch (error) {
    console.log("❌ ERRO CARTÃO SDK:", error);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro ao gerar link de cartão",
      detalhe: error?.response?.data || error,
    });
  }
});

/* =========================
   NOTIFICAÇÃO EFI CARTÃO
========================= */
app.post("/notificacao-efi", async (req, res) => {
  try {
    console.log("📥 Notificação EFI cartão:", JSON.stringify(req.body, null, 2));
    return res.status(200).send("OK");
  } catch (error) {
    console.log("❌ ERRO NOTIFICAÇÃO EFI:", error.message);
    return res.status(500).send("Erro");
  }
});

/* =========================
   LISTAR HISTÓRICO POR JOGADOR
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
   LISTAR PENDENTES DE UM MÊS
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
