import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:curitiba_empreiteira_ponto/src/api_client.dart';
import 'package:curitiba_empreiteira_ponto/src/offline_queue.dart';

class MemoryStorage implements QueueStorage {
  final Map<String, String> values = {};
  bool legacy = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async { values[key] = value; }
  @override
  Future<bool> hasLegacyQueue() async => legacy;
}

class FakeApi extends ApiClient {
  FakeApi() { accessToken = 'test-session'; sessionUserId = 'first-user'; }
  bool accepted = true;
  bool online = true;
  bool fail = false;
  Completer<void>? started;
  Completer<void>? resume;
  final List<String> received = [];
  @override
  Future<bool> isOnline() async => online;
  @override
  Future<bool> punch(Map<String, dynamic> payload) async {
    received.add(payload['offline_batch_id'] as String);
    started?.complete();
    if (resume != null) await resume!.future;
    if (fail) throw StateError('network timeout');
    return accepted;
  }
}

Map<String, dynamic> payload(String id) => {'offline_batch_id': id};

void main() {
  test('enqueue concurrent with sync preserves the new item', () async {
    final store = MemoryStorage();
    final queue = OfflineQueue(storage: store);
    final api = FakeApi()..started = Completer<void>()..resume = Completer<void>();
    await queue.enqueue(payload('old'), ownerId: 'first-user');
    final syncing = queue.sync(api);
    await api.started!.future;
    final adding = queue.enqueue(payload('new'), ownerId: 'first-user');
    api.resume!.complete();
    await syncing;
    await adding;
    expect(await queue.pendingCount(ownerId: 'first-user'), 1);
    expect(api.received, ['old']);
  });

  test('rejected and timed out items are retained', () async {
    final queue = OfflineQueue(storage: MemoryStorage());
    final api = FakeApi()..accepted = false;
    await queue.enqueue(payload('retry'), ownerId: 'first-user');
    expect((await queue.sync(api)).remaining, 1);
    api.fail = true;
    expect((await queue.sync(api)).remaining, 1);
  });

  test('another session cannot send the first users records', () async {
    final queue = OfflineQueue(storage: MemoryStorage());
    final api = FakeApi()..sessionUserId = 'second-user';
    await queue.enqueue(payload('private'), ownerId: 'first-user');
    expect((await queue.sync(api)).accepted, 0);
    expect(api.received, isEmpty);
    expect(await queue.pendingCount(ownerId: 'first-user'), 1);
  });

  test('stable batch IDs deduplicate and queue is bounded', () async {
    final queue = OfflineQueue(storage: MemoryStorage(), maxItems: 1);
    await queue.enqueue(payload('stable'), ownerId: 'first-user');
    await queue.enqueue(payload('stable'), ownerId: 'first-user');
    await expectLater(queue.enqueue(payload('another'), ownerId: 'first-user'), throwsStateError);
    expect(await queue.pendingCount(ownerId: 'first-user'), 1);
  });

  test('retention expires old data without sending it', () async {
    var time = DateTime.utc(2026, 10, 10);
    final queue = OfflineQueue(storage: MemoryStorage(), now: () => time);
    await queue.enqueue(payload('old'), ownerId: 'first-user');
    time = time.add(const Duration(hours: 24));
    final api = FakeApi();
    final result = await queue.sync(api);
    expect(result.expired, 1);
    expect(result.remaining, 0);
    expect(api.received, isEmpty);
  });

  test('legacy plaintext cannot be attributed to current user automatically', () async {
    final queue = OfflineQueue(storage: MemoryStorage()..legacy = true);
    await expectLater(queue.pendingCount(ownerId: 'first-user'), throwsStateError);
  });
}
