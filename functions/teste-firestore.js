const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

console.log("project_id:", serviceAccount.project_id);
console.log("client_email:", serviceAccount.client_email);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function testar() {
  try {
    const docRef = db.collection("mensalidades").doc("teste123");

    await docRef.set({
      nome: "Paulo",
      valor: 50,
      criadoEm: new Date().toISOString(),
    });

    const doc = await docRef.get();

    console.log("SUCESSO");
    console.log(doc.exists, doc.data());
  } catch (error) {
    console.error("ERRO:");
    console.error(error);
  }
}

testar();