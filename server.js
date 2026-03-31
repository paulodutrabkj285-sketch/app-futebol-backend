app.post("/configurar-webhook", async (req, res) => {
  try {
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

    const webhookUrl =
     "https://app-futebol-backend.onrender.com/webhook/efi/pix?ignorar=";

    const response = await axios.put(
      `https://pix.api.efipay.com.br/v2/webhook/${process.env.PIX_KEY}`,
      {
        webhookUrl,
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-skip-mtls-checking": "true", // 🔥 ESSA LINHA É A CHAVE
        },
      }
    );

    res.json({
      sucesso: true,
      webhookUrl,
      retorno: response.data,
    });
  } catch (error) {
    console.log("Erro webhook:", error.response?.data || error.message);

    res.status(500).json({
      erro: "Erro ao configurar webhook",
      detalhe: error.response?.data || error.message,
    });
  }
});