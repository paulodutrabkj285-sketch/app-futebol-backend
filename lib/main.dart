import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  runApp(const GenteFeraApp());
}

class GenteFeraApp extends StatelessWidget {
  const GenteFeraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Gente Fera FC',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0B0B0B),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD62828),
          brightness: Brightness.dark,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white.withOpacity(0.06),
          labelStyle: const TextStyle(color: Colors.white70),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide(color: Colors.white.withOpacity(0.12)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xFFD62828), width: 1.4),
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      home: const TelaInicial(),
    );
  }
}

class AppConfig {
  static const double valorMensalidade = 50.0;
  static const String usuarioAdmin = 'admin';
  static const String senhaAdmin = '1234';

  static const String backendBaseUrl =
      'https://app-futebol-backend.onrender.com';
}

class Jogador {
  final String id;
  final String nome;
  final String telefone;
  final String cpf;
  final Map<String, dynamic> pagamentos;
  final Timestamp? criadoEm;

  Jogador({
    required this.id,
    required this.nome,
    required this.telefone,
    required this.cpf,
    required this.pagamentos,
    this.criadoEm,
  });

  factory Jogador.fromFirestore(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? {};

    return Jogador(
      id: doc.id,
      nome: (data['nome'] ?? '').toString(),
      telefone: (data['telefone'] ?? '').toString(),
      cpf: (data['cpf'] ?? '').toString(),
      pagamentos: Map<String, dynamic>.from(data['pagamentos'] ?? {}),
      criadoEm: data['criado_em'] as Timestamp?,
    );
  }
}

class HistoricoPagamento {
  final String id;
  final String? txid;
  final String? nome;
  final String? cpf;
  final String? mes;
  final double? valor;
  final String? status;
  final String? formaPagamento;
  final String? statusEfi;
  final DateTime? criadoEm;
  final DateTime? pagoEm;

  HistoricoPagamento({
    required this.id,
    this.txid,
    this.nome,
    this.cpf,
    this.mes,
    this.valor,
    this.status,
    this.formaPagamento,
    this.statusEfi,
    this.criadoEm,
    this.pagoEm,
  });

  factory HistoricoPagamento.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic value) {
      if (value == null) return null;

      if (value is String) {
        return DateTime.tryParse(value)?.toLocal();
      }

      if (value is Map<String, dynamic>) {
        final seconds = value['_seconds'];
        if (seconds is int) {
          return DateTime.fromMillisecondsSinceEpoch(seconds * 1000).toLocal();
        }
      }

      return null;
    }

    double? parseValor(dynamic value) {
      if (value == null) return null;
      if (value is int) return value.toDouble();
      if (value is double) return value;
      if (value is String) return double.tryParse(value);
      return null;
    }

    return HistoricoPagamento(
      id: (json['id'] ?? '').toString(),
      txid: json['txid']?.toString(),
      nome: json['nome']?.toString(),
      cpf: json['cpf']?.toString(),
      mes: json['mes']?.toString(),
      valor: parseValor(json['valor']),
      status: json['status']?.toString(),
      formaPagamento: json['formaPagamento']?.toString(),
      statusEfi: json['statusEfi']?.toString(),
      criadoEm: parseDate(json['criadoEm']),
      pagoEm: parseDate(json['pagoEm']),
    );
  }
}

class AppTexts {
  static const List<String> meses = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
}

class FirebaseJogadoresService {
  final CollectionReference<Map<String, dynamic>> jogadoresRef =
      FirebaseFirestore.instance.collection('jogadores');

  Stream<List<Jogador>> listarJogadores() {
    return jogadoresRef.snapshots().map((snapshot) {
      debugPrint(
        'Firestore listarJogadores -> docs: ${snapshot.docs.length} | '
        'fromCache: ${snapshot.metadata.isFromCache} | '
        'pendingWrites: ${snapshot.metadata.hasPendingWrites}',
      );
      return snapshot.docs.map(Jogador.fromFirestore).toList();
    });
  }

  Future<void> adicionarJogador({
    required String nome,
    required String telefone,
    required String cpf,
  }) async {
    final pagamentosIniciais = <String, bool>{};

    for (final mes in AppTexts.meses) {
      pagamentosIniciais[mes] = false;
    }

    try {
      final doc = await jogadoresRef.add({
        'nome': nome,
        'telefone': telefone,
        'cpf': cpf,
        'pagamentos': pagamentosIniciais,
        'criado_em': FieldValue.serverTimestamp(),
      });

      await doc.get(const GetOptions(source: Source.server));
    } on FirebaseException catch (e) {
      throw Exception('Firebase: ${e.code} - ${e.message}');
    } catch (e) {
      throw Exception('Erro real ao salvar: $e');
    }
  }

  Future<void> alternarPagamento({
    required Jogador jogador,
    required String mes,
  }) async {
    final pagoAtual = (jogador.pagamentos[mes] ?? false) == true;

    await jogadoresRef.doc(jogador.id).update({
      'pagamentos.$mes': !pagoAtual,
    });
  }

  Future<void> marcarPagamentoComoPago({
    required String jogadorId,
    required String mes,
  }) async {
    await jogadoresRef.doc(jogadorId).update({
      'pagamentos.$mes': true,
    });
  }

  Future<void> excluirJogador(String id) async {
    await jogadoresRef.doc(id).delete();
  }
}

class TelaInicial extends StatelessWidget {
  const TelaInicial({super.key});

  @override
  Widget build(BuildContext context) {
    final largura = MediaQuery.of(context).size.width;
    final telaPequena = largura < 700;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0000),
        foregroundColor: Colors.white,
        title: const Text('Gente Fera FC'),
      ),
      drawer: Drawer(
        child: Container(
          color: const Color(0xFF0B0B0B),
          child: SafeArea(
            child: Column(
              children: [
                const SizedBox(height: 20),
                const Icon(Icons.sports_soccer, size: 60, color: Colors.white),
                const SizedBox(height: 10),
                const Text(
                  'Gente Fera FC',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Divider(color: Colors.white24),
                ListTile(
                  leading: const Icon(Icons.home, color: Colors.white),
                  title: const Text(
                    'Início',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () => Navigator.pop(context),
                ),
                ListTile(
                  leading: const Icon(Icons.lock, color: Colors.red),
                  title: const Text(
                    'Administrador',
                    style: TextStyle(color: Colors.red),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const LoginAdminPage(),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
      body: Stack(
        children: [
          const FundoTela(),
          Positioned.fill(
            child: IgnorePointer(
              child: Center(
                child: Opacity(
                  opacity: 0.28,
                  child: Transform.scale(
                    scale: telaPequena ? 1.4 : 1.9,
                    child: Image.asset(
                      'assets/mascote.png',
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: Container(
              color: Colors.black.withOpacity(0.42),
            ),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 950),
                  child: Column(
                    children: [
                      const SizedBox(height: 10),
                      Text(
                        'Gente Fera FC',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: telaPequena ? 28 : 40,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: caixaEscura(),
                        child: Column(
                          children: [
                            SizedBox(
                              height: telaPequena ? 120 : 150,
                              child: Image.asset(
                                'assets/logo.png',
                                fit: BoxFit.contain,
                                errorBuilder: (_, __, ___) => const Icon(
                                  Icons.sports_soccer,
                                  size: 90,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'Mensalidade do Time',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: telaPequena ? 28 : 38,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Controle financeiro do Gente Fera FC',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: telaPequena ? 15 : 18,
                              ),
                            ),
                            const SizedBox(height: 20),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.08),
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Column(
                                children: [
                                  const Text(
                                    'Mensalidade do mês',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      fontSize: 16,
                                    ),
                                  ),
                                  const SizedBox(height: 10),
                                  Text(
                                    'R\$ ${AppConfig.valorMensalidade.toStringAsFixed(2)}',
                                    style: TextStyle(
                                      color: Colors.red.shade300,
                                      fontSize: telaPequena ? 34 : 46,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        height: 62,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => const TelaPagamento(),
                              ),
                            );
                          },
                          icon: const Icon(Icons.pix, color: Colors.white),
                          label: const Text(
                            'Pagar Mensalidade',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: botaoVermelho(),
                        ),
                      ),
                      const SizedBox(height: 28),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(18),
                        decoration: caixaEscura(),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: const [
                            Text(
                              'Patrocinadores',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            SizedBox(height: 14),
                            Wrap(
                              spacing: 12,
                              runSpacing: 12,
                              children: [
                                CardPatrocinador(
                                  nome: 'Sportello',
                                  imagem: 'assets/sportello.png',
                                ),
                                CardPatrocinador(
                                  nome: 'LS',
                                  imagem: 'assets/ls.png',
                                ),
                                CardPatrocinador(
                                  nome: 'Linear Gesso',
                                  imagem: 'assets/linear.png',
                                ),
                                CardPatrocinador(
                                  nome: '2C',
                                  imagem: 'assets/c2.png',
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class TelaPagamento extends StatefulWidget {
  final String? jogadorId;
  final String? mes;
  final String? nomeJogador;
  final String? cpfJogador;

  const TelaPagamento({
    super.key,
    this.jogadorId,
    this.mes,
    this.nomeJogador,
    this.cpfJogador,
  });

  @override
  State<TelaPagamento> createState() => _TelaPagamentoState();
}

class _TelaPagamentoState extends State<TelaPagamento> {
  late final TextEditingController nomeController;
  late final TextEditingController cpfController;

  bool carregando = false;
  bool verificandoPagamento = false;
  bool pagamentoConfirmado = false;

  String? erro;
  String? txid;
  String? copiaecola;
  String? statusTexto;
  Uint8List? qrCodeBytes;

  Timer? _timer;

  @override
  void initState() {
    super.initState();
    nomeController = TextEditingController(text: widget.nomeJogador ?? '');
    cpfController = TextEditingController(text: widget.cpfJogador ?? '');
  }

  Future<void> gerarPix() async {
    final nome = nomeController.text.trim();
    final cpf = cpfController.text.trim();

    if (nome.isEmpty || cpf.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Preencha nome e CPF para gerar o PIX.'),
        ),
      );
      return;
    }

    _timer?.cancel();

    setState(() {
      carregando = true;
      erro = null;
      txid = null;
      copiaecola = null;
      qrCodeBytes = null;
      pagamentoConfirmado = false;
      verificandoPagamento = false;
      statusTexto = 'Gerando PIX...';
    });

    try {
      final body = {
        'nome': nome,
        'valor': AppConfig.valorMensalidade,
        'cpf': cpf,
        'jogadorId': widget.jogadorId,
        'mes': widget.mes,
      };

      final response = await http.post(
        Uri.parse('${AppConfig.backendBaseUrl}/criar-pix'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['sucesso'] == true) {
        String imagemBase64 = (data['imagem'] ?? '').toString();

        if (imagemBase64.startsWith('data:image/png;base64,')) {
          imagemBase64 =
              imagemBase64.replaceFirst('data:image/png;base64,', '');
        }

        Uint8List? imageBytes;
        if (imagemBase64.isNotEmpty) {
          imageBytes = base64Decode(imagemBase64);
        }

        setState(() {
          txid = data['txid']?.toString();
          copiaecola = data['copiaecola']?.toString();
          qrCodeBytes = imageBytes;
          statusTexto = 'PIX gerado. Aguardando pagamento...';
        });

        iniciarVerificacaoAutomatica();
      } else {
        setState(() {
          erro = data['detalhe']?.toString() ??
              data['erro']?.toString() ??
              'Erro ao gerar PIX.';
          statusTexto = null;
        });
      }
    } catch (e) {
      setState(() {
        erro = 'Falha ao conectar com o servidor: $e';
        statusTexto = null;
      });
    } finally {
      if (mounted) {
        setState(() {
          carregando = false;
        });
      }
    }
  }

  Future<void> pagarComCartao() async {
    final nome = nomeController.text.trim();
    final cpf = cpfController.text.trim();

    if (nome.isEmpty || cpf.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Preencha nome e CPF para pagar com cartão.'),
        ),
      );
      return;
    }

    setState(() {
      carregando = true;
      erro = null;
      statusTexto = 'Gerando link de pagamento com cartão...';
    });

    try {
      final body = {
        'jogadorId': widget.jogadorId,
        'nome': nome,
        'valor': AppConfig.valorMensalidade,
        'cpf': cpf,
        'mes': widget.mes,
      };

      final response = await http.post(
        Uri.parse('${AppConfig.backendBaseUrl}/criar-link-cartao'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200 && data['sucesso'] == true) {
        final paymentUrl = (data['paymentUrl'] ?? '').toString();

        if (paymentUrl.isEmpty) {
          throw Exception('Link de pagamento não retornado pelo backend.');
        }

        final uri = Uri.parse(paymentUrl);
        final abriu = await launchUrl(uri, mode: LaunchMode.externalApplication);

        if (!abriu) {
          throw Exception('Não foi possível abrir o link de pagamento.');
        }

        if (!mounted) return;

        setState(() {
          statusTexto = 'Link de pagamento aberto com sucesso.';
        });
      } else {
        throw Exception(
          data['mensagem']?.toString() ??
              data['erro']?.toString() ??
              'Erro ao gerar link de cartão.',
        );
      }
    } catch (e) {
      if (!mounted) return;

      setState(() {
        erro = 'Erro no pagamento com cartão: $e';
        statusTexto = null;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro no cartão: $e'),
        ),
      );
    } finally {
      if (!mounted) return;

      setState(() {
        carregando = false;
      });
    }
  }

  void iniciarVerificacaoAutomatica() {
    if (txid == null) return;

    _timer?.cancel();

    setState(() {
      verificandoPagamento = true;
    });

    _timer = Timer.periodic(const Duration(seconds: 5), (_) async {
      await verificarPagamento();
    });
  }

  Future<void> marcarPagamentoNoFirestore() async {
    if ((widget.jogadorId ?? '').isEmpty || (widget.mes ?? '').isEmpty) {
      return;
    }

    await FirebaseFirestore.instance
        .collection('jogadores')
        .doc(widget.jogadorId)
        .update({
      'pagamentos.${widget.mes}': true,
    });
  }

  Future<void> verificarPagamento() async {
    if (txid == null || pagamentoConfirmado) return;

    try {
      final response = await http.get(
        Uri.parse('${AppConfig.backendBaseUrl}/verificar-pagamento/$txid'),
      );

      final data = jsonDecode(response.body);

      if (response.statusCode == 200) {
        final bool pago = data['pago'] == true;
        final String? statusEfi = data['statusEfi']?.toString();

        if (pago) {
          _timer?.cancel();

          await marcarPagamentoNoFirestore();

          if (!mounted) return;

          setState(() {
            pagamentoConfirmado = true;
            verificandoPagamento = false;
            statusTexto = 'Pagamento confirmado com sucesso!';
          });

          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Pagamento confirmado!'),
            ),
          );
        } else {
          if (!mounted) return;

          setState(() {
            statusTexto =
                'Aguardando pagamento... Status EFI: ${statusEfi ?? 'desconhecido'}';
          });
        }
      } else {
        if (!mounted) return;

        setState(() {
          statusTexto = 'Erro ao verificar pagamento';
        });
      }
    } catch (e) {
      if (!mounted) return;

      setState(() {
        statusTexto = 'Erro ao verificar pagamento';
      });
    }
  }

  Future<void> copiarPix() async {
    if (copiaecola == null || copiaecola!.isEmpty) return;

    await Clipboard.setData(ClipboardData(text: copiaecola!));

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('PIX copia e cola copiado com sucesso.'),
      ),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    nomeController.dispose();
    cpfController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tituloMes = (widget.mes != null && widget.mes!.trim().isNotEmpty)
        ? widget.mes!
        : 'Mensalidade';

    return Scaffold(
      backgroundColor: const Color(0xFF0B0B0B),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0000),
        foregroundColor: Colors.white,
        title: Text('Pagamento - $tituloMes'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: caixaEscura(),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.account_balance_wallet,
                      size: 90,
                      color: Colors.white,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Pagamento de $tituloMes',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    if ((widget.nomeJogador ?? '').isNotEmpty)
                      Text(
                        'Jogador: ${widget.nomeJogador}',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 16,
                        ),
                      ),
                    if ((widget.nomeJogador ?? '').isNotEmpty)
                      const SizedBox(height: 8),
                    Text(
                      'R\$ ${AppConfig.valorMensalidade.toStringAsFixed(2)}',
                      style: const TextStyle(
                        color: Colors.red,
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 22),
                    TextField(
                      controller: nomeController,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'Nome do jogador',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: cpfController,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'CPF',
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      height: 55,
                      child: ElevatedButton.icon(
                        onPressed: carregando ? null : gerarPix,
                        icon: carregando
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.qr_code),
                        label: Text(
                          carregando ? 'Gerando PIX...' : 'Gerar PIX',
                        ),
                        style: botaoVermelho(),
                      ),
                    ),
                    const SizedBox(height: 18),
                    if (erro != null)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.red.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: Colors.red.withOpacity(0.35),
                          ),
                        ),
                        child: Text(
                          erro!,
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
                    if (erro != null) const SizedBox(height: 14),
                    if (statusTexto != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: pagamentoConfirmado
                              ? Colors.green.withOpacity(0.18)
                              : Colors.blue.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: pagamentoConfirmado
                                ? Colors.green.withOpacity(0.35)
                                : Colors.blue.withOpacity(0.35),
                          ),
                        ),
                        child: Text(
                          statusTexto!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: pagamentoConfirmado
                                ? Colors.greenAccent
                                : Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                    ],
                    if (qrCodeBytes != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Column(
                          children: [
                            const Text(
                              'Escaneie o QR Code',
                              style: TextStyle(
                                color: Colors.black,
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 14),
                            Image.memory(
                              qrCodeBytes!,
                              width: 220,
                              height: 220,
                              fit: BoxFit.contain,
                            ),
                            const SizedBox(height: 12),
                            if (txid != null)
                              SelectableText(
                                'TXID: $txid',
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.black87),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                    ],
                    if (copiaecola != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.35),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.10),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Pix copia e cola',
                              style: TextStyle(
                                color: Colors.white70,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            SelectableText(
                              copiaecola!,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        height: 55,
                        child: ElevatedButton.icon(
                          onPressed: copiarPix,
                          icon: const Icon(Icons.copy),
                          label: const Text('Copiar código Pix'),
                          style: botaoVermelho(),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (txid != null && !pagamentoConfirmado) ...[
                      SizedBox(
                        width: double.infinity,
                        height: 55,
                        child: ElevatedButton.icon(
                          onPressed: verificarPagamento,
                          icon: const Icon(Icons.refresh),
                          label: Text(
                            verificandoPagamento
                                ? 'Verificando pagamento...'
                                : 'Já paguei / Verificar agora',
                          ),
                          style: botaoEscuro(),
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],
                    if (pagamentoConfirmado) ...[
                      const SizedBox(height: 12),
                      const Icon(
                        Icons.check_circle,
                        color: Colors.green,
                        size: 80,
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'Pagamento confirmado!',
                        style: TextStyle(
                          color: Colors.greenAccent,
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 18),
                    ],
                    SizedBox(
                      width: double.infinity,
                      height: 55,
                      child: ElevatedButton.icon(
                        onPressed: carregando ? null : pagarComCartao,
                        icon: const Icon(Icons.credit_card),
                        label: const Text('Pagar com Cartão'),
                        style: botaoEscuro(),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'O PIX é gerado online pelo backend e a tela verifica automaticamente se o pagamento foi concluído.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 15,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class LoginAdminPage extends StatefulWidget {
  const LoginAdminPage({super.key});

  @override
  State<LoginAdminPage> createState() => _LoginAdminPageState();
}

class _LoginAdminPageState extends State<LoginAdminPage> {
  final TextEditingController usuarioController = TextEditingController();
  final TextEditingController senhaController = TextEditingController();
  String erro = '';
  bool carregando = false;

  Future<void> entrar() async {
    setState(() {
      erro = '';
      carregando = true;
    });

    if (!mounted) return;

    if (usuarioController.text.trim() == AppConfig.usuarioAdmin &&
        senhaController.text == AppConfig.senhaAdmin) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const PainelAdminPage()),
      );
    } else {
      setState(() {
        erro = 'Usuário ou senha inválidos';
        carregando = false;
      });
    }
  }

  InputDecoration campoClaro(String label) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(
        color: Colors.black54,
        fontWeight: FontWeight.w500,
      ),
      filled: true,
      fillColor: Colors.white,
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Colors.black26),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(
          color: Color(0xFFD62828),
          width: 1.5,
        ),
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
      ),
    );
  }

  @override
  void dispose() {
    usuarioController.dispose();
    senhaController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B0B0B),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A0000),
        foregroundColor: Colors.white,
        title: const Text('Login do Administrador'),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
                boxShadow: const [
                  BoxShadow(
                    color: Colors.black26,
                    blurRadius: 18,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.admin_panel_settings,
                    size: 60,
                    color: Color(0xFFD62828),
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    controller: usuarioController,
                    style: const TextStyle(
                      color: Colors.black,
                      fontSize: 16,
                    ),
                    decoration: campoClaro('Usuário'),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: senhaController,
                    obscureText: true,
                    style: const TextStyle(
                      color: Colors.black,
                      fontSize: 16,
                    ),
                    decoration: campoClaro('Senha'),
                    onSubmitted: (_) => entrar(),
                  ),
                  const SizedBox(height: 14),
                  if (erro.isNotEmpty)
                    Text(
                      erro,
                      style: const TextStyle(
                        color: Colors.red,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  if (erro.isNotEmpty) const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: carregando ? null : entrar,
                      style: botaoVermelho(),
                      child: carregando
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: Colors.white,
                              ),
                            )
                          : const Text(
                              'Entrar',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PainelAdminPage extends StatefulWidget {
  const PainelAdminPage({super.key});

  @override
  State<PainelAdminPage> createState() => _PainelAdminPageState();
}

class _PainelAdminPageState extends State<PainelAdminPage> {
  final FirebaseJogadoresService service = FirebaseJogadoresService();
  final ScrollController _scrollController = ScrollController();

  String mesSelecionado = AppTexts.meses[DateTime.now().month - 1];

  Future<void> mostrarDialogAdicionarJogador() async {
    final nomeController = TextEditingController();
    final telefoneController = TextEditingController();
    final cpfController = TextEditingController();

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        bool salvando = false;
        String erroLocal = '';

        return StatefulBuilder(
          builder: (context, setLocalState) {
            Future<void> salvarJogador() async {
              final nome = nomeController.text.trim();
              final telefone = telefoneController.text.trim();
              final cpf = cpfController.text.trim();

              if (nome.isEmpty) {
                setLocalState(() {
                  erroLocal = 'Digite o nome do jogador.';
                });
                return;
              }

              if (salvando) return;

              try {
                setLocalState(() {
                  salvando = true;
                  erroLocal = '';
                });

                await service.adicionarJogador(
                  nome: nome,
                  telefone: telefone,
                  cpf: cpf,
                );

                if (!mounted) return;

                Navigator.of(dialogContext).pop();

                ScaffoldMessenger.of(this.context).showSnackBar(
                  const SnackBar(content: Text('Jogador salvo com sucesso.')),
                );
              } on FirebaseException catch (e) {
                setLocalState(() {
                  salvando = false;
                  erroLocal = 'Erro Firebase: ${e.message ?? e.code}';
                });
              } catch (e) {
                setLocalState(() {
                  salvando = false;
                  erroLocal = 'Erro ao salvar jogador: $e';
                });
              }
            }

            return AlertDialog(
              title: const Text('Adicionar jogador'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: nomeController,
                      style: const TextStyle(color: Colors.black),
                      decoration: const InputDecoration(
                        labelText: 'Nome do jogador',
                        labelStyle: TextStyle(color: Colors.black54),
                        border: OutlineInputBorder(),
                        fillColor: Colors.white,
                        filled: true,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: cpfController,
                      keyboardType: TextInputType.number,
                      style: const TextStyle(color: Colors.black),
                      decoration: const InputDecoration(
                        labelText: 'CPF',
                        labelStyle: TextStyle(color: Colors.black54),
                        border: OutlineInputBorder(),
                        fillColor: Colors.white,
                        filled: true,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: telefoneController,
                      keyboardType: TextInputType.phone,
                      style: const TextStyle(color: Colors.black),
                      decoration: const InputDecoration(
                        labelText: 'Telefone / WhatsApp',
                        labelStyle: TextStyle(color: Colors.black54),
                        border: OutlineInputBorder(),
                        fillColor: Colors.white,
                        filled: true,
                      ),
                    ),
                    if (erroLocal.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        erroLocal,
                        style: const TextStyle(
                          color: Colors.red,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed:
                      salvando ? null : () => Navigator.pop(dialogContext),
                  child: const Text('Cancelar'),
                ),
                ElevatedButton(
                  onPressed: salvando ? null : salvarJogador,
                  child: salvando
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Salvar'),
                ),
              ],
            );
          },
        );
      },
    );

    nomeController.dispose();
    telefoneController.dispose();
    cpfController.dispose();
  }

  Future<void> alternarPagamento(Jogador jogador) async {
    try {
      await service.alternarPagamento(
        jogador: jogador,
        mes: mesSelecionado,
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Status de ${jogador.nome} atualizado com sucesso.'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao atualizar pagamento: $e')),
      );
    }
  }

  Future<void> excluirJogador(String id, String nome) async {
    try {
      await service.excluirJogador(id);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$nome foi excluído com sucesso.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao excluir jogador: $e')),
      );
    }
  }

  String statusJogadorNoMes(Jogador jogador) {
    final pago = (jogador.pagamentos[mesSelecionado] ?? false) == true;
    return pago ? 'Pago' : 'Pendente';
  }

  Color corStatusJogador(Jogador jogador) {
    final pago = (jogador.pagamentos[mesSelecionado] ?? false) == true;
    return pago ? Colors.green : Colors.red;
  }

  String _formatarData(DateTime? data) {
    if (data == null) return '-';
    final dia = data.day.toString().padLeft(2, '0');
    final mes = data.month.toString().padLeft(2, '0');
    final ano = data.year.toString();
    final hora = data.hour.toString().padLeft(2, '0');
    final minuto = data.minute.toString().padLeft(2, '0');
    return '$dia/$mes/$ano às $hora:$minuto';
  }

  String gerarMensagemCobranca(Jogador jogador) {
    return 'Fala, ${jogador.nome}! ⚽\n\nSua mensalidade de $mesSelecionado do Gente Fera FC está pendente.\n\nValor: R\$ ${AppConfig.valorMensalidade.toStringAsFixed(2)}\n\nAssim que pagar, o sistema atualiza automaticamente.\nSe já pagou, desconsidere esta mensagem 👍';
  }

  String normalizarTelefoneBrasil(String telefone) {
    final apenasNumeros = telefone.replaceAll(RegExp(r'[^0-9]'), '');

    if (apenasNumeros.isEmpty) return '';
    if (apenasNumeros.startsWith('55')) return apenasNumeros;

    return '55$apenasNumeros';
  }

  Future<void> cobrarNoWhatsApp(Jogador jogador) async {
    if (jogador.telefone.trim().isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Esse jogador não tem telefone cadastrado.'),
        ),
      );
      return;
    }

    final telefone = normalizarTelefoneBrasil(jogador.telefone);
    final mensagem = Uri.encodeComponent(gerarMensagemCobranca(jogador));
    final uri = Uri.parse('https://wa.me/$telefone?text=$mensagem');

    final abriu = await launchUrl(uri, mode: LaunchMode.externalApplication);

    if (!abriu && mounted) {
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Cobrança para ${jogador.nome}'),
          content: SingleChildScrollView(
            child: SelectableText(gerarMensagemCobranca(jogador)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
          ],
        ),
      );
    }
  }

  Future<void> cobrarPendentesNoWhatsApp(List<Jogador> jogadores) async {
    final pendentes = jogadores
        .where((j) => (j.pagamentos[mesSelecionado] ?? false) != true)
        .toList();

    if (pendentes.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não há jogadores pendentes em $mesSelecionado.'),
        ),
      );
      return;
    }

    final pendentesComTelefone =
        pendentes.where((j) => j.telefone.trim().isNotEmpty).toList();

    if (pendentesComTelefone.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Nenhum jogador pendente tem telefone cadastrado.'),
        ),
      );
      return;
    }

    final jogadoresSemTelefone = pendentes
        .where((j) => j.telefone.trim().isEmpty)
        .map((j) => j.nome)
        .toList();

    if (!mounted) return;

    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Cobrar pendentes de $mesSelecionado'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pendentes com WhatsApp: ${pendentesComTelefone.length}',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),
                ...pendentesComTelefone.map(
                  (j) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text('• ${j.nome}'),
                  ),
                ),
                if (jogadoresSemTelefone.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  const Text(
                    'Sem telefone cadastrado:',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.red,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...jogadoresSemTelefone.map(
                    (nome) => Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text('• $nome'),
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                const Text(
                  'Ao continuar, o sistema vai abrir uma conversa do WhatsApp por vez para cobrança.',
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);

              for (final jogador in pendentesComTelefone) {
                await cobrarNoWhatsApp(jogador);
                await Future.delayed(const Duration(milliseconds: 800));
              }
            },
            child: const Text('Cobrar agora'),
          ),
        ],
      ),
    );
  }

  Future<void> mostrarHistoricoJogador(Jogador jogador) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(
        child: CircularProgressIndicator(),
      ),
    );

    try {
      final response = await http.get(
        Uri.parse(
          '${AppConfig.backendBaseUrl}/historico-pagamentos/${jogador.id}',
        ),
      );

      if (!mounted) return;
      Navigator.pop(context);

      final data = jsonDecode(response.body);

      if (response.statusCode != 200 || data['ok'] != true) {
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: Text('Histórico - ${jogador.nome}'),
            content: const Text('Não foi possível carregar o histórico.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Fechar'),
              ),
            ],
          ),
        );
        return;
      }

      final List historicoBruto = data['historico'] ?? [];
      final historico = historicoBruto
          .map(
            (item) => HistoricoPagamento.fromJson(
              Map<String, dynamic>.from(item),
            ),
          )
          .toList();

      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Histórico - ${jogador.nome}'),
          content: SizedBox(
            width: 520,
            child: historico.isEmpty
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'CPF: ${jogador.cpf.isEmpty ? "-" : formatarCpf(jogador.cpf)}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Telefone: ${jogador.telefone.isEmpty ? "-" : formatarTelefone(jogador.telefone)}',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 16),
                      const Text('Nenhum pagamento registrado no histórico.'),
                    ],
                  )
                : SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'CPF: ${jogador.cpf.isEmpty ? "-" : formatarCpf(jogador.cpf)}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Telefone: ${jogador.telefone.isEmpty ? "-" : formatarTelefone(jogador.telefone)}',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 16),
                        ...historico.map(
                          (item) => Container(
                            width: double.infinity,
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(14),
                              color: Colors.grey.shade100,
                              border: Border.all(color: Colors.black12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Mês: ${item.mes ?? "-"}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Valor: R\$ ${(item.valor ?? 0).toStringAsFixed(2)}',
                                ),
                                Text('Status: ${item.status ?? "-"}'),
                                Text('Forma: ${item.formaPagamento ?? "pix"}'),
                                Text(
                                  'Pago em: ${_formatarData(item.pagoEm ?? item.criadoEm)}',
                                ),
                                if ((item.txid ?? '').isNotEmpty)
                                  SelectableText('TXID: ${item.txid}'),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      Navigator.pop(context);

      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('Histórico - ${jogador.nome}'),
          content: Text('Erro ao carregar histórico: $e'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
          ],
        ),
      );
    }
  }

  Future<void> confirmarExclusao(Jogador jogador) async {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Excluir jogador'),
        content: Text('Deseja realmente excluir ${jogador.nome}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              await excluirJogador(jogador.id, jogador.nome);
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
  }

  void abrirPagamentoParaJogador(Jogador jogador) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => TelaPagamento(
          jogadorId: jogador.id,
          mes: mesSelecionado,
          nomeJogador: jogador.nome,
          cpfJogador: jogador.cpf,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final largura = MediaQuery.of(context).size.width;
    final telaPequena = largura < 760;

    return Scaffold(
      backgroundColor: const Color(0xFFF4F4F4),
      appBar: AppBar(
        title: const Text('Painel do Administrador'),
        backgroundColor: const Color(0xFFD62828),
        foregroundColor: Colors.white,
      ),
      floatingActionButton: FloatingActionButton.small(
        onPressed: mostrarDialogAdicionarJogador,
        backgroundColor: const Color(0xFFD62828),
        foregroundColor: Colors.white,
        child: const Icon(Icons.person_add),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
      body: StreamBuilder<List<Jogador>>(
        stream: service.listarJogadores(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Erro ao carregar jogadores:\n${snapshot.error}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.black87),
                ),
              ),
            );
          }

          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          final jogadores = snapshot.data ?? [];

          final pagantesDoMes = jogadores
              .where((j) => (j.pagamentos[mesSelecionado] ?? false) == true)
              .length;

          final pendentesDoMes = jogadores
              .where((j) => (j.pagamentos[mesSelecionado] ?? false) != true)
              .length;

          final totalJogadores = jogadores.length;
          final valorPrevistoDoMes = totalJogadores * AppConfig.valorMensalidade;
          final arrecadadoDoMes = pagantesDoMes * AppConfig.valorMensalidade;
          final faltaReceberDoMes = valorPrevistoDoMes - arrecadadoDoMes;
          final percentualRecebido = totalJogadores == 0
              ? 0.0
              : (pagantesDoMes / totalJogadores).clamp(0.0, 1.0);

          return Column(
            children: [
              Expanded(
                child: Scrollbar(
                  controller: _scrollController,
                  thumbVisibility: true,
                  child: ListView(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text(
                              'Mês:',
                              style: TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF1C1C1C),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFFF7F7),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: const Color(0xFFD62828).withOpacity(0.45),
                                  width: 1.4,
                                ),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Colors.black12,
                                    blurRadius: 8,
                                    offset: Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: DropdownButtonHideUnderline(
                                child: DropdownButton<String>(
                                  value: mesSelecionado,
                                  dropdownColor: Colors.white,
                                  icon: const Icon(
                                    Icons.keyboard_arrow_down_rounded,
                                    color: Color(0xFFD62828),
                                  ),
                                  style: const TextStyle(
                                    color: Color(0xFFD62828),
                                    fontSize: 18,
                                    fontWeight: FontWeight.w800,
                                  ),
                                  items: AppTexts.meses.map((mes) {
                                    return DropdownMenuItem<String>(
                                      value: mes,
                                      child: Text(
                                        mes,
                                        style: const TextStyle(
                                          color: Color(0xFFD62828),
                                          fontSize: 17,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    );
                                  }).toList(),
                                  onChanged: (value) {
                                    if (value != null) {
                                      setState(() {
                                        mesSelecionado = value;
                                      });
                                    }
                                  },
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          CardResumoAdmin(
                            titulo: 'Jogadores',
                            valor: totalJogadores.toString(),
                            icone: Icons.groups,
                            cor: const Color(0xFF6C63FF),
                            largura: telaPequena ? 160 : 210,
                          ),
                          CardResumoAdmin(
                            titulo: 'Pagantes',
                            valor: pagantesDoMes.toString(),
                            icone: Icons.check_circle,
                            cor: Colors.green,
                            largura: telaPequena ? 160 : 210,
                          ),
                          CardResumoAdmin(
                            titulo: 'Pendentes',
                            valor: pendentesDoMes.toString(),
                            icone: Icons.warning_amber_rounded,
                            cor: Colors.orange,
                            largura: telaPequena ? 160 : 210,
                          ),
                          CardResumoAdmin(
                            titulo: 'Previsto',
                            valor: 'R\$ ${valorPrevistoDoMes.toStringAsFixed(2)}',
                            icone: Icons.account_balance_wallet,
                            cor: const Color(0xFF8E44AD),
                            largura: telaPequena ? 160 : 210,
                          ),
                          CardResumoAdmin(
                            titulo: 'Arrecadado',
                            valor: 'R\$ ${arrecadadoDoMes.toStringAsFixed(2)}',
                            icone: Icons.attach_money,
                            cor: Colors.blue,
                            largura: telaPequena ? 160 : 210,
                          ),
                          CardResumoAdmin(
                            titulo: 'Falta receber',
                            valor: 'R\$ ${faltaReceberDoMes.toStringAsFixed(2)}',
                            icone: Icons.trending_down,
                            cor: Colors.redAccent,
                            largura: telaPequena ? 160 : 210,
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                          boxShadow: const [
                            BoxShadow(
                              color: Colors.black12,
                              blurRadius: 10,
                              offset: Offset(0, 5),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Resumo financeiro de $mesSelecionado',
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1C1C1C),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              'Recebido: R\$ ${arrecadadoDoMes.toStringAsFixed(2)} de R\$ ${valorPrevistoDoMes.toStringAsFixed(2)}',
                              style: const TextStyle(
                                fontSize: 15,
                                color: Color(0xFF444444),
                              ),
                            ),
                            const SizedBox(height: 12),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(999),
                              child: LinearProgressIndicator(
                                minHeight: 12,
                                value: percentualRecebido,
                                backgroundColor: Colors.grey.shade300,
                                valueColor: const AlwaysStoppedAnimation<Color>(
                                  Color(0xFFD62828),
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              '${(percentualRecebido * 100).toStringAsFixed(0)}% dos jogadores estão com a mensalidade em dia neste mês.',
                              style: const TextStyle(
                                fontSize: 14,
                                color: Color(0xFF555555),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: ElevatedButton.icon(
                          onPressed: () => cobrarPendentesNoWhatsApp(jogadores),
                          icon: const Icon(Icons.campaign),
                          label: Text('Cobrar pendentes de $mesSelecionado'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF25D366),
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 18,
                              vertical: 14,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        'Jogadores - $mesSelecionado',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 12),
                      if (jogadores.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 30),
                          child: Center(
                            child: Text(
                              'Nenhum jogador cadastrado ainda.',
                              style: TextStyle(
                                fontSize: 18,
                                color: Colors.black87,
                              ),
                            ),
                          ),
                        )
                      else
                        ...jogadores.map((jogador) {
                          final pago =
                              (jogador.pagamentos[mesSelecionado] ?? false) == true;

                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: Card(
                              color: Colors.white,
                              elevation: 2,
                              shadowColor: Colors.black12,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        CircleAvatar(
                                          backgroundColor:
                                              pago ? Colors.green : Colors.red,
                                          child: Icon(
                                            pago ? Icons.check : Icons.close,
                                            color: Colors.white,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                jogador.nome,
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 20,
                                                  color: Color(0xFF1E1E1E),
                                                ),
                                              ),
                                              const SizedBox(height: 6),
                                              Text(
                                                'CPF: ${jogador.cpf.isEmpty ? "-" : formatarCpf(jogador.cpf)}\n'
                                                'WhatsApp: ${jogador.telefone.isEmpty ? "-" : formatarTelefone(jogador.telefone)}\n'
                                                'Status em $mesSelecionado: ${statusJogadorNoMes(jogador)}\n'
                                                'Valor do mês: R\$ ${AppConfig.valorMensalidade.toStringAsFixed(2)}',
                                                style: const TextStyle(
                                                  color: Color(0xFF4E4E4E),
                                                  height: 1.4,
                                                  fontSize: 14.5,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 12,
                                            vertical: 8,
                                          ),
                                          decoration: BoxDecoration(
                                            color: corStatusJogador(jogador)
                                                .withOpacity(0.12),
                                            borderRadius:
                                                BorderRadius.circular(12),
                                          ),
                                          child: Text(
                                            statusJogadorNoMes(jogador),
                                            style: TextStyle(
                                              color: corStatusJogador(jogador),
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 8,
                                      children: [
                                        ElevatedButton.icon(
                                          onPressed: () =>
                                              alternarPagamento(jogador),
                                          icon: Icon(
                                            pago ? Icons.undo : Icons.check,
                                          ),
                                          label: Text(
                                            pago
                                                ? 'Marcar pendente'
                                                : 'Marcar pago',
                                          ),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor:
                                                pago ? Colors.orange : Colors.green,
                                            foregroundColor: Colors.white,
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                            ),
                                          ),
                                        ),
                                        ElevatedButton.icon(
                                          onPressed: () =>
                                              abrirPagamentoParaJogador(jogador),
                                          icon: const Icon(Icons.pix),
                                          label: const Text('Gerar Pix'),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor:
                                                const Color(0xFFD62828),
                                            foregroundColor: Colors.white,
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                            ),
                                          ),
                                        ),
                                        ElevatedButton.icon(
                                          onPressed: () =>
                                              mostrarHistoricoJogador(jogador),
                                          icon: const Icon(Icons.history),
                                          label: const Text('Histórico'),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: Colors.blueGrey,
                                            foregroundColor: Colors.white,
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                            ),
                                          ),
                                        ),
                                        ElevatedButton.icon(
                                          onPressed: () =>
                                              cobrarNoWhatsApp(jogador),
                                          icon: const Icon(Icons.message),
                                          label: const Text('Cobrar WhatsApp'),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor:
                                                const Color(0xFF25D366),
                                            foregroundColor: Colors.white,
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                            ),
                                          ),
                                        ),
                                        ElevatedButton.icon(
                                          onPressed: () =>
                                              confirmarExclusao(jogador),
                                          icon: const Icon(Icons.delete),
                                          label: const Text('Excluir'),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: Colors.red,
                                            foregroundColor: Colors.white,
                                            shape: RoundedRectangleBorder(
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        }),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class CardResumoAdmin extends StatelessWidget {
  final String titulo;
  final String valor;
  final IconData icone;
  final Color cor;
  final double largura;

  const CardResumoAdmin({
    super.key,
    required this.titulo,
    required this.valor,
    required this.icone,
    required this.cor,
    required this.largura,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: largura,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: const [
            BoxShadow(
              color: Colors.black12,
              blurRadius: 10,
              offset: Offset(0, 5),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icone, color: cor, size: 30),
            const SizedBox(height: 10),
            Text(
              titulo,
              style: const TextStyle(
                fontSize: 16,
                color: Colors.black54,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              valor,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: Colors.black87,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  final String titulo;
  final Color cor;

  const StatusChip({
    super.key,
    required this.titulo,
    required this.cor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: cor.withOpacity(0.16),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        titulo,
        style: TextStyle(
          color: cor,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

String somenteNumeros(String valor) {
  return valor.replaceAll(RegExp(r'[^0-9]'), '');
}

String formatarCpf(String cpf) {
  final numeros = somenteNumeros(cpf);
  if (numeros.length != 11) return numeros.isEmpty ? '-' : numeros;
  return '${numeros.substring(0, 3)}.${numeros.substring(3, 6)}.${numeros.substring(6, 9)}-${numeros.substring(9, 11)}';
}

String formatarTelefone(String telefone) {
  final numeros = somenteNumeros(telefone);
  if (numeros.isEmpty) return '-';

  if (numeros.length == 11) {
    return '(${numeros.substring(0, 2)}) ${numeros.substring(2, 7)}-${numeros.substring(7, 11)}';
  }

  if (numeros.length == 10) {
    return '(${numeros.substring(0, 2)}) ${numeros.substring(2, 6)}-${numeros.substring(6, 10)}';
  }

  return numeros;
}

class CardPatrocinador extends StatelessWidget {
  final String nome;
  final String imagem;

  const CardPatrocinador({
    super.key,
    required this.nome,
    required this.imagem,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 180,
      height: 110,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.red.withOpacity(0.20),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Expanded(
            child: Image.asset(
              imagem,
              fit: BoxFit.contain,
              errorBuilder: (context, error, stackTrace) {
                return Center(
                  child: Text(
                    nome,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 6),
          Text(
            nome,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class FundoTela extends StatelessWidget {
  const FundoTela({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF050505),
            Color(0xFF160000),
            Color(0xFF2B0000),
            Color(0xFF080808),
          ],
        ),
      ),
    );
  }
}

BoxDecoration caixaEscura() {
  return BoxDecoration(
    color: Colors.black.withOpacity(0.45),
    borderRadius: BorderRadius.circular(24),
    border: Border.all(
      color: Colors.red.withOpacity(0.25),
    ),
  );
}

ButtonStyle botaoVermelho() {
  return ElevatedButton.styleFrom(
    backgroundColor: const Color(0xFFD62828),
    foregroundColor: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(18),
    ),
  );
}

ButtonStyle botaoEscuro() {
  return ElevatedButton.styleFrom(
    backgroundColor: const Color(0xFF1A1A1A),
    foregroundColor: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(18),
    ),
  );
}