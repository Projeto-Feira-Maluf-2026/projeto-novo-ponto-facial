import 'package:flutter/material.dart';

import 'src/api_client.dart';
import 'src/offline_queue.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PontoFacialApp());
}

class PontoFacialApp extends StatelessWidget {
  const PontoFacialApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Curitiba Empreiteira',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.system,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff95c11f)),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff95c11f),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const ShellPage(),
    );
  }
}

class ShellPage extends StatefulWidget {
  const ShellPage({super.key});

  @override
  State<ShellPage> createState() => _ShellPageState();
}

class _ShellPageState extends State<ShellPage> {
  int index = 0;
  final api = ApiClient();
  final queue = OfflineQueue();

  late final pages = [
    PunchPage(api: api, queue: queue),
    const HistoryPage(),
    const HoursPage(),
    const NotificationsPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ponto Facial'),
        actions: [
          IconButton(
            tooltip: 'Sincronizar',
            onPressed: () => queue.sync(api),
            icon: const Icon(Icons.sync),
          ),
        ],
      ),
      body: pages[index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.face_retouching_natural), label: 'Ponto'),
          NavigationDestination(icon: Icon(Icons.history), label: 'Historico'),
          NavigationDestination(icon: Icon(Icons.timer), label: 'Horas'),
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Avisos'),
        ],
      ),
    );
  }
}

class PunchPage extends StatefulWidget {
  const PunchPage({required this.api, required this.queue, super.key});

  final ApiClient api;
  final OfflineQueue queue;

  @override
  State<PunchPage> createState() => _PunchPageState();
}

class _PunchPageState extends State<PunchPage> {
  bool loading = false;
  String result = 'Pronto para registro';

  Future<void> punch() async {
    setState(() {
      loading = true;
      result = 'Validando face...';
    });

    final payload = {
      'worksite_id': 'w1',
      'device_id': 'mobile',
      'face': {
        'embedding': List<double>.filled(512, 0.02),
        'liveness_score': 0.93,
        'quality_score': 0.89,
        'motion_score': 0.78,
        'face_count': 1,
        'spoof_hints': <String>[],
      },
      'offline_batch_id': DateTime.now().millisecondsSinceEpoch.toString(),
    };

    final online = await widget.api.isOnline();
    if (!online) {
      await widget.queue.enqueue(payload);
      setState(() {
        loading = false;
        result = 'Registro salvo offline';
      });
      return;
    }

    try {
      final accepted = await widget.api.punch(payload);
      setState(() {
        loading = false;
        result = accepted ? 'Ponto registrado' : 'Registro enviado para revisao';
      });
    } catch (_) {
      await widget.queue.enqueue(payload);
      setState(() {
        loading = false;
        result = 'Sem conexao, salvo na fila offline';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.face_retouching_natural, size: 64),
                const SizedBox(height: 16),
                Text(result, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: loading ? null : punch,
                  icon: loading
                      ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.camera_alt),
                  label: const Text('Registrar ponto'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Card(
          child: ListTile(
            leading: Icon(Icons.wifi_off),
            title: Text('Modo offline'),
            subtitle: Text('Registros sao sincronizados quando a conexao voltar'),
          ),
        ),
      ],
    );
  }
}

class HistoryPage extends StatelessWidget {
  const HistoryPage({super.key});

  @override
  Widget build(BuildContext context) {
    final records = [
      ('Hoje 07:02', 'Entrada', 'Aceito'),
      ('Hoje 11:58', 'Almoco', 'Aceito'),
      ('Hoje 13:03', 'Retorno', 'Aceito'),
      ('Ontem 17:31', 'Saida', 'Aceito'),
    ];
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: records.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final item = records[index];
        return Card(
          child: ListTile(
            leading: const Icon(Icons.verified),
            title: Text(item.$2),
            subtitle: Text(item.$1),
            trailing: Text(item.$3),
          ),
        );
      },
    );
  }
}

class HoursPage extends StatelessWidget {
  const HoursPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        Card(child: ListTile(leading: Icon(Icons.today), title: Text('Hoje'), trailing: Text('7h 42m'))),
        Card(child: ListTile(leading: Icon(Icons.calendar_view_week), title: Text('Semana'), trailing: Text('38h 10m'))),
        Card(child: ListTile(leading: Icon(Icons.calendar_month), title: Text('Mes'), trailing: Text('154h 25m'))),
      ],
    );
  }
}

class NotificationsPage extends StatelessWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        Card(child: ListTile(leading: Icon(Icons.notifications_active), title: Text('Inicio de jornada'), subtitle: Text('Seu turno inicia as 07:00'))),
        Card(child: ListTile(leading: Icon(Icons.warning_amber), title: Text('Hora extra'), subtitle: Text('Validacao do supervisor necessaria'))),
      ],
    );
  }
}
