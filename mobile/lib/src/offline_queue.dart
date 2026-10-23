import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';

abstract class QueueStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<bool> hasLegacyQueue();
}

class SecureQueueStorage implements QueueStorage {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<bool> hasLegacyQueue() async {
    final preferences = await SharedPreferences.getInstance();
    return preferences.containsKey('offline_punch_queue');
  }
}

class QueueSyncResult {
  const QueueSyncResult({required this.accepted, required this.remaining, required this.expired});
  final int accepted;
  final int remaining;
  final int expired;
}

class OfflineQueue {
  OfflineQueue({QueueStorage? storage, DateTime Function()? now,
      this.maxItems = 50, this.maxAge = const Duration(hours: 24)})
      : _storage = storage ?? SecureQueueStorage(), _now = now ?? DateTime.now;

  final QueueStorage _storage;
  final DateTime Function() _now;
  final int maxItems;
  // Storage retention, not a policy that authorizes backdated attendance.
  final Duration maxAge;
  static Future<void> _tail = Future<void>.value();

  Future<T> _exclusive<T>(Future<T> Function() action) async {
    final previous = _tail;
    final released = Completer<void>();
    _tail = released.future;
    await previous;
    try { return await action(); } finally { released.complete(); }
  }

  String _key(String ownerId) {
    if (ownerId.isEmpty) throw ArgumentError('Usuario autenticado obrigatorio');
    return 'offline_punch_queue_v2_${base64Url.encode(utf8.encode(ownerId))}';
  }

  Future<List<Map<String, dynamic>>> _read(String ownerId) async {
    if (await _storage.hasLegacyQueue()) {
      throw StateError('Fila antiga sem usuario vinculado. Revisao e exclusao local exigidas; nenhum envio automatico.');
    }
    final raw = await _storage.read(_key(ownerId));
    if (raw == null) return [];
    // Corruption fails closed; never replace an unreadable queue with empty data.
    return (jsonDecode(raw) as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
  }

  Future<void> _write(String ownerId, List<Map<String, dynamic>> items) =>
      _storage.write(_key(ownerId), jsonEncode(items));

  bool _expired(Map<String, dynamic> item) =>
      _now().toUtc().difference(DateTime.parse(item['queued_at'] as String)) >= maxAge;

  Future<void> enqueue(Map<String, dynamic> payload, {required String ownerId}) {
    final encoded = jsonEncode(payload);
    final snapshot = jsonDecode(encoded) as Map<String, dynamic>;
    return _exclusive(() async {
      final batchId = snapshot['offline_batch_id'];
      if (batchId is! String || batchId.isEmpty) {
        throw ArgumentError('ID de idempotencia estavel obrigatorio');
      }
      if (utf8.encode(encoded).length > 512 * 1024) throw ArgumentError('Registro excede limite local');
      if (snapshot.containsKey('access_token') || snapshot.containsKey('authorization')) {
        throw ArgumentError('Credenciais nunca pertencem a fila');
      }
      final items = await _read(ownerId);
      if (items.any((item) => (item['payload'] as Map)['offline_batch_id'] == batchId)) return;
      if (items.length >= maxItems) throw StateError('Fila cheia; sincronize os registros pendentes');
      // Snapshot prevents the caller from mutating data after enqueue starts.
      items.add({'queued_at': _now().toUtc().toIso8601String(), 'payload': snapshot});
      await _write(ownerId, items);
    });
  }

  Future<int> pendingCount({required String ownerId}) => _exclusive(() async => (await _read(ownerId)).length);

  Future<QueueSyncResult> sync(ApiClient api) => _exclusive(() async {
    final ownerId = api.sessionUserId;
    final token = api.accessToken;
    if (ownerId == null || token == null) throw StateError('Sessao autenticada obrigatoria');
    var items = await _read(ownerId);
    var accepted = 0;
    final expired = items.where(_expired).length;
    if (expired > 0) {
      items = items.where((item) => !_expired(item)).toList();
      await _write(ownerId, items);
    }
    if (!await api.isOnline()) return QueueSyncResult(accepted: 0, remaining: items.length, expired: expired);
    // Only confirmed persistence removes a non-expired item; checkpoint every ACK.
    for (final item in List<Map<String, dynamic>>.of(items)) {
      if (api.sessionUserId != ownerId || api.accessToken != token) break;
      bool persisted;
      try {
        persisted = await api.punch(Map<String, dynamic>.from(item['payload'] as Map));
      } catch (_) { break; }
      if (api.sessionUserId != ownerId || api.accessToken != token) break;
      if (!persisted) continue;
      items.remove(item);
      accepted++;
      await _write(ownerId, items);
    }
    return QueueSyncResult(accepted: accepted, remaining: items.length, expired: expired);
  });
}
