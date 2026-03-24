const express = require("express");
const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const certificado = fs.readFileSync(
  path.resolve(__dirname, "certificado.p12")
);

const agent = new https.Agent({
  pfx: certificado,
  passphrase: "",
});

function gerarTxid() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let txid = "";
  for (let i = 0; i < 30; i++) {
    txid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return txid;
}

app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, valor, cpf } = req.body;

    const tokenResponse = await axios.post(
      "https://pix.api.efipay.com.br/oauth/token",
      {
        grant_type: "client_credentials",
      },
      {
        httpsAgent: agent,
        auth: {
          username: "Client_Id_aec6183933b5525a3eb935c9652372bb7439f8d6",
          password: "Client_Secret_bb88b9e3f06b2e96d1ca463c93c2a0a567361703",
        },
      }
    );

    const token = tokenResponse.data.access_token;
    const txid = gerarTxid();

    const cobranca = await axios.put(
      `https://pix.api.efipay.com.br/v2/cob/${txid}`,
      {
        calendario: { expiracao: 3600 },
        devedor: {
          cpf: cpf,
          nome: nome,
        },
        valor: {
          original: Number(valor).toFixed(2),
        },
        chave: "juniordutrabkj285@gmail.com",
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

    res.json({
      sucesso: true,
      txid: txid,
      copiaecola: qrCode.data.qrcode,
      imagem: qrCode.data.imagemQrcode,
    });
  } catch (error) {
    console.log("ERRO COMPLETO:");
    console.log(error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao gerar PIX",
      detalhe: error.response?.data || error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});